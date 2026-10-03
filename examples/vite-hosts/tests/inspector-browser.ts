import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { checkInspector, connectInspector, inspectOriginal } from './inspector-browser-actions.ts';

await using cleanup = new AsyncDisposableStack();
const servers = [];
for (const host of ['devframe', 'devtools'] as const) {
  const server = await createServer({
    configFile: fileURLToPath(new URL('../inspector.config.ts', import.meta.url)),
    mode: host,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
  });
  cleanup.defer(() => server.close());
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address !== null && address !== undefined && typeof address !== 'string');
  servers.push({ host, origin: `http://127.0.0.1:${address.port}` });
}
const browser = await chromium.launch({ headless: true });
cleanup.defer(() => browser.close());
const version = browser.version();
const context = await browser.newContext();
const pageErrors: string[] = [];
const consoleErrors: string[] = [];
context.on('weberror', (error) => pageErrors.push(error.error().message));
const pages = [];
for (const server of servers) {
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const current = { ...server, page };
  const provider = await connectInspector(current);
  await inspectOriginal(page);
  pages.push({ ...current, provider });
}
const [devframe, devtools] = pages;
assert.ok(devframe !== undefined && devtools !== undefined);
assert.notDeepEqual(devframe.provider, devtools.provider);
const observations = [
  await checkInspector(devframe, devtools),
  await checkInspector(devtools, devframe),
];
await cleanup.disposeAsync();
assert.deepEqual(pageErrors, []);
assert.deepEqual(consoleErrors, []);
const checks = [
  'the unchanged native renderer dispatches shared inspector actions through the selected provider',
  'inspect reads actual original and configured response bytes from the owned Vite endpoint',
  'marker registration affects a fresh document before its first parser script without changing the existing document',
  'reset restores baseline configuration and future HTML while preserving provider identity',
  'the two live backends retain distinct provider identities and native business state',
];
const receipt = {
  browser: version,
  observations,
  checks: servers.flatMap(({ host }) => checks.map((check) => `${host}: ${check}`)),
  pageErrors,
  consoleErrors,
  limitations: [
    'Native development only; preview, packed artifacts and alternate renderers are not exercised',
  ],
};
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/inspector-chromium.json', JSON.stringify(receipt, null, 2) + '\n');
console.info(styleText('green', '✅ [vite-hosts/inspector]'), receipt);
