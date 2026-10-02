import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';
import { providerFromVite } from '@devkit/example-vite-hosts';
import type { ExampleHost } from '@devkit/example-vite-hosts';
import { chromium, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { build, createServer, preview } from 'vite';
import type { PreviewServer, ViteDevServer } from 'vite';
import { checkCounterPages, connectPage } from './browser-counter.ts';
import { checkWatchedPreview } from './browser-watched.ts';

const configFile = fileURLToPath(new URL('../host.config.ts', import.meta.url));
const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url));
await mkdir(artifacts, { recursive: true });
await using cleanup = new AsyncDisposableStack();
const browser = await chromium.launch({ headless: true });
cleanup.defer(() => browser.close());
const context = await browser.newContext();
const errors: string[] = [];
context.on('weberror', (error) => errors.push(error.error().message));
const browserPage = await context.newPage();
const peer = await context.newPage();
const observations = [];
const watched = [];
for (const host of ['devframe', 'devtools'] as const) {
  observations.push(
    await checkDevelopment(browserPage, peer, host),
    await checkPreview(browserPage, peer, host),
  );
  watched.push(await checkWatchedPreview(browserPage, peer, host));
}
assert.deepEqual(errors, []);
const receipt = { browser: browser.version(), observations, watched, pageErrors: errors };
await writeFile('artifacts/html-timing.json', JSON.stringify(receipt, null, 2) + '\n');
console.info(styleText('green', '✅ [vite-hosts]'), receipt);

async function checkDevelopment(page: Page, second: Page, host: ExampleHost) {
  await using lifetime = new AsyncDisposableStack();
  const server = await createServer({
    configFile,
    mode: host,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
  });
  lifetime.defer(() => server.close());
  await server.listen();
  const provider = await providerFromVite(server);
  assert.equal(provider.provider.id, `example.${host}-vite`);
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === 'string')
    throw new Error('Development server did not expose a TCP address');
  const origin = `http://127.0.0.1:${address.port}`;
  await connectPage(page, origin, provider.provider);
  const snapshot = await firstScript(page);
  const counter = await checkCounterPages({
    first: page,
    second,
    origin,
    provider,
    close: () => captureAndClose(page, `${host}-development`, server),
  });
  return { host, mode: 'development', providerId: provider.provider.id, snapshot, counter };
}

async function checkPreview(page: Page, second: Page, host: ExampleHost) {
  await using lifetime = new AsyncDisposableStack();
  const output = await mkdtemp(`${artifacts}built-browser-`);
  lifetime.defer(() => rm(output, { recursive: true, force: true }));
  /** The same assets must work with either live preview backend after an independent build. */
  await build({ configFile, mode: 'devframe', logLevel: 'silent', build: { outDir: output } });
  const builtHtml = await readFile(`${output}/index.html`, 'utf8');
  let previewTransforms = 0;
  const server = await preview({
    configFile,
    mode: host,
    logLevel: 'silent',
    build: { outDir: output },
    preview: { host: '127.0.0.1', port: 0 },
    plugins: [
      {
        name: 'test:observe-preview-html',
        transformIndexHtml() {
          previewTransforms += 1;
        },
      },
    ],
  });
  lifetime.defer(() => server.close());
  const provider = await providerFromVite(server);
  assert.equal(provider.provider.id, `example.${host}-preview`);
  const address = server.httpServer.address();
  if (address === null || typeof address === 'string')
    throw new Error('Preview server did not expose a TCP address');
  const origin = `http://127.0.0.1:${address.port}`;
  assert.equal(await (await fetch(origin)).text(), builtHtml);
  await connectPage(page, origin, provider.provider);
  const snapshot = await firstScript(page);
  const counter = await checkCounterPages({
    first: page,
    second,
    origin,
    provider,
    close: () => captureAndClose(page, `${host}-preview`, server),
  });
  assert.equal(previewTransforms, 0);
  return {
    host,
    mode: 'build-preview',
    providerId: provider.provider.id,
    snapshot,
    counter,
    previewTransforms,
  };
}

async function firstScript(page: Page) {
  const expected = { bootstrapReadyState: 'loading', pageReadyState: 'loading' };
  await expect(page.locator('#script-timing')).toHaveText(JSON.stringify(expected));
  const snapshot: unknown = JSON.parse(
    (await page.locator('html').getAttribute('data-first-script')) ?? 'null',
  );
  assert.deepEqual(snapshot, expected);
  return snapshot;
}

async function captureAndClose(page: Page, name: string, server: ViteDevServer | PreviewServer) {
  await page.screenshot({ path: `artifacts/${name}.png`, fullPage: true });
  await server.close();
}
