import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { styleText } from 'node:util';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { assertChromiumReceipt } from './receipt.ts';

const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<!doctype html><title>Owned debugger target</title>');
});
const profile = await mkdtemp(join(tmpdir(), 'devkit-debugger-'));
let browser: BrowserContext | undefined;
const pageErrors: string[] = [];
try {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected loopback server');
  const targetUrl = `http://127.0.0.1:${address.port}/target`;
  const extensionPath = resolvePath('dist/chromium');
  browser = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  browser.on('weberror', (error) => pageErrors.push(error.error().message));
  const target = await browser.newPage();
  await target.goto(targetUrl);
  const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
  const control = await browser.newPage();
  await control.goto(`chrome-extension://${new URL(worker.url()).host}/probe.html`);
  const receipt = await boundedReceipt(
    control.evaluate(
      (url) => chrome.runtime.sendMessage<unknown>({ kind: 'run', targetUrl: url }),
      targetUrl,
    ),
  );
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/chromium.json',
    JSON.stringify({ browser: browser.browser()?.version(), pageErrors, receipt }, null, 2) + '\n',
  );
  assertChromiumReceipt(receipt);
  assert.deepEqual(pageErrors, []);
  console.info(
    styleText('green', '🧪 [debugger/chromium]'),
    'Native command, event and ownership checks passed',
    browser.browser()?.version(),
  );
} finally {
  await cleanupFixtures();
}

async function cleanupFixtures(): Promise<void> {
  const cleanup = await Promise.allSettled([
    browser?.close(),
    new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    }),
  ]);
  await rm(profile, { recursive: true, force: true });
  const failures = cleanup
    .filter((result) => result.status === 'rejected')
    .map((result): unknown => result.reason);
  if (failures.length > 0) throw new AggregateError(failures, 'Browser fixture cleanup failed');
}

async function boundedReceipt(operation: Promise<unknown>): Promise<unknown> {
  const timeout = new AbortController();
  try {
    return await Promise.race([
      operation,
      delay(30_000, undefined, { signal: timeout.signal }).then(() => {
        throw new Error('Debugger extension did not finish within 30 seconds');
      }),
    ]);
  } finally {
    timeout.abort();
  }
}
