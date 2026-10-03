import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';
import { Driver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';
import { createServer } from 'vite';
import { checkInspector, connectInspector, inspectOriginal } from './inspector-firefox-actions.ts';
import { checkInspectorRenderer, inspectorRendererChecks } from './inspector-firefox-renderer.ts';

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
const options = new Options().addArguments('-headless');
if (process.env.FIREFOX_BINARY !== undefined) options.setBinary(process.env.FIREFOX_BINARY);
const driver = Driver.createSession(options, new ServiceBuilder().build());
cleanup.defer(() => driver.quit());
const capabilities = await driver.getCapabilities();
const pages = [];
for (const server of servers) {
  await driver.switchTo().newWindow('tab');
  const current = { ...server, driver, window: await driver.getWindowHandle() };
  const provider = await connectInspector(current);
  await inspectOriginal(current);
  pages.push({ ...current, provider });
}
const [devframe, devtools] = pages;
assert.ok(devframe !== undefined && devtools !== undefined);
assert.notDeepEqual(devframe.provider, devtools.provider);
const observations = [
  await checkInspector(devframe, devtools),
  await checkInspector(devtools, devframe),
];
const rendererObservations = [];
for (const primary of pages) {
  await driver.switchTo().newWindow('tab');
  const peer = { ...primary, window: await driver.getWindowHandle() };
  await connectInspector(peer);
  rendererObservations.push({
    host: primary.host,
    ...(await checkInspectorRenderer(primary, peer)),
  });
  await driver.switchTo().window(peer.window);
  await driver.close();
  await driver.switchTo().window(primary.window);
}
await cleanup.disposeAsync();
const checks = [
  'the unchanged native renderer dispatches shared inspector actions through the selected provider',
  'inspect reads actual original and configured response bytes from the owned Vite endpoint',
  'marker registration affects a fresh document before its first parser script without changing the existing document',
  'reset restores baseline configuration and future HTML while preserving provider identity',
  'the two live backends retain distinct provider identities and native business state',
  'visible native renderer alerts, Vite overlays and connection failures fail the proof',
];
const receipt = {
  browser: capabilities.getBrowserVersion(),
  driver: capabilities.get('moz:geckodriverVersion') as unknown,
  observations,
  rendererObservations,
  checks: servers.flatMap(({ host }) =>
    [...checks, ...inspectorRendererChecks].map((check) => `${host}: ${check}`),
  ),
  limitations: [
    'No global page-error or browser-console capture through WebDriver Classic',
    'Native development only; preview and packed host artifacts are not exercised',
  ],
};
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/inspector-firefox.json', JSON.stringify(receipt, null, 2) + '\n');
console.info(styleText('green', '✅ [vite-hosts/inspector/firefox]'), receipt);
