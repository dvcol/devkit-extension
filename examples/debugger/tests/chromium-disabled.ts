import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { styleText } from 'node:util';
import { chromium, expect } from '@playwright/test';
import { build } from 'vite';
import { z } from 'zod';

const receiptSchema = z.object({
  passed: z.literal(true),
  result: z.object({
    installedServices: z.literal(0),
    capability: z.literal('unavailable'),
    plugin: z.object({
      status: z.literal('inactive'),
      contributions: z.array(
        z.object({
          status: z.literal('waiting'),
          reason: z.literal('dependency-unavailable'),
        }),
      ),
    }),
    actionError: z.object({ code: z.literal('unavailable-capability'), message: z.string() }),
    diagnostics: z.array(z.string()),
    nativeDebuggerAvailable: z.literal(false),
    permissions: z.object({ permissions: z.array(z.string()), origins: z.array(z.string()) }),
    manifestPermissions: z.array(z.string()),
  }),
});

const receipt = await runDisabledProfile();
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/chromium-disabled.json', `${JSON.stringify(receipt, null, 2)}\n`);
console.info(
  styleText('green', '🧪 [debugger/chromium-disabled]'),
  'Omitted optional CDB service rejects without debugger authority or page evaluation',
  receipt.browser,
);

async function runDisabledProfile() {
  await using cleanup = new AsyncDisposableStack();
  const directory = await mkdtemp(join(tmpdir(), 'devkit-cdb-disabled-'));
  cleanup.defer(() => rm(directory, { recursive: true, force: true }));
  const extensionPath = join(directory, 'extension');
  await buildDisabledExtension(extensionPath);
  const targetUrl = await fixtureServer(cleanup);
  const browser = await chromium.launchPersistentContext(join(directory, 'profile'), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  cleanup.defer(() => browser.close());
  const pageErrors: string[] = [];
  browser.on('weberror', (error) => pageErrors.push(error.error().message));
  const target = await browser.newPage();
  await target.goto(targetUrl);
  await expect(target.locator('#title-reads')).toHaveText('0');
  const documentToken = await target.locator('body').getAttribute('data-document');
  assert.notEqual(documentToken, null);
  const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
  const control = await browser.newPage();
  await control.goto(`chrome-extension://${new URL(worker.url()).host}/probe.html`);
  const native: unknown = await control.evaluate(() =>
    chrome.runtime.sendMessage<unknown>('check-disabled-profile'),
  );
  checkReceipt(native);
  await expect(target.locator('#title-reads')).toHaveText('0');
  assert.equal(await target.locator('title').textContent(), 'Owned disabled CDB target');
  assert.equal(await target.locator('body').getAttribute('data-document'), documentToken);
  assert.deepEqual(pageErrors, []);
  return {
    browser: browser.browser()?.version(),
    profile: 'cdb-disabled',
    checks: [
      'The default Chromium profile omits debugger permission and has no native debugger API',
      'The real runtime retains a waiting action, no service and an unavailable capability',
      'Invoking the optional action rejects with unavailable-capability without reading the page title',
      'Provider, browser, server and temporary extension/profile are disposed before receipt publication',
    ],
    native,
    page: { titleReads: 0, title: 'Owned disabled CDB target', sameDocument: true },
    pageErrors,
    scope:
      'Optional CDB capability profile; this does not implement inspectorCapability through CDB',
  };
}

function checkReceipt(value: unknown): void {
  const { result } = receiptSchema.parse(value);
  assert.equal(result.plugin.contributions.length, 1);
  assert.deepEqual(result.manifestPermissions, []);
  assert.deepEqual(result.permissions, { permissions: [], origins: [] });
  assert.deepEqual(result.diagnostics, ['unavailable-capability']);
  assert.match(result.actionError.message, /example\.debugger\.read-page-title@1 is unavailable/u);
}

async function buildDisabledExtension(outDir: string): Promise<void> {
  await build({
    configFile: false,
    devtools: false,
    logLevel: 'error',
    build: {
      outDir,
      target: 'esnext',
      rolldownOptions: {
        input: resolvePath('tests/fixtures/disabled.ts'),
        output: { entryFileNames: 'background.js' },
      },
    },
  });
  await writeFile(
    join(outDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Disabled optional CDB fixture',
      version: '0.0.1',
      background: { service_worker: 'background.js', type: 'module' },
      permissions: [],
    }),
  );
  await writeFile(join(outDir, 'probe.html'), '<!doctype html><title>Disabled CDB control</title>');
}

async function fixtureServer(cleanup: AsyncDisposableStack): Promise<string> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    response.end(`<!doctype html><title>Owned disabled CDB target</title>
      <body><output id="title-reads">0</output><script>
        document.body.dataset.document = crypto.randomUUID();
        const title = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
        Object.defineProperty(document, 'title', {get() {
          const output = document.querySelector('#title-reads');
          output.textContent = String(Number(output.textContent) + 1);
          return title.get.call(document);
        }});
      </script></body>`);
  });
  cleanup.defer(async () => {
    if (!server.listening) return;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected loopback server');
  return `http://127.0.0.1:${address.port}/target`;
}
