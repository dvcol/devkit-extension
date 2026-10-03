import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { styleText } from 'node:util';
import { chromium } from '@playwright/test';
import { checkInspectorProduction } from './inspector-production-actions.ts';

await using cleanup = new AsyncDisposableStack();
const browser = await chromium.launch({ headless: true });
cleanup.defer(() => browser.close());
const version = browser.version();
const context = await browser.newContext();
const pageErrors: string[] = [];
const consoleErrors: { message: string; url: string }[] = [];
const httpErrors: { url: string; status: number }[] = [];
context.on('weberror', (error) => pageErrors.push(error.error().message));
context.on('page', (page) => {
  page.on('console', (message) => {
    if (message.type() === 'error')
      consoleErrors.push({ message: message.text(), url: message.location().url });
  });
  page.on('response', (response) => {
    if (response.status() >= 400)
      httpErrors.push({ url: response.url(), status: response.status() });
  });
});
const observations = [];
for (const host of ['devframe', 'devtools'] as const)
  observations.push(await checkInspectorProduction(context, host));
await cleanup.disposeAsync();
assert.deepEqual(pageErrors, []);
const devtools = observations.find((observation) => observation.host === 'devtools');
assert.ok(devtools !== undefined);
const missingMetadata = `${devtools.origin}/__devframes/__connection.json`;
/** Native discovery probes Devframe before DevTools; preview correctly returns 404 for its absent endpoint. */
assert.ok(httpErrors.length > 0);
for (const response of httpErrors)
  assert.deepEqual(response, { url: missingMetadata, status: 404 });
for (const error of consoleErrors) {
  assert.equal(error.url, missingMetadata);
  assert.match(error.message, /Failed to load resource:.*404/u);
}
const receipt = {
  browser: version,
  observations,
  checks: [
    'preview starts before assets and serves real Vite-built inspector generations through either native backend',
    'built reference and custom renderers share live inspector actions and native state',
    'runtime marker requests reject visibly without modifying state or built HTML',
    'a genuine syntax failure publishes failed status while preserving complete assets and live provider state',
    'fresh clients during failure receive the previous generation and current native state',
    'a valid edit publishes new assets without replacing the old document or provider, and old URLs retain their bytes',
    'preview shutdown removes both native views and disables renderer controls',
  ],
  pageErrors,
  consoleErrors,
  httpErrors,
  limitations: [
    'No automatic production-page reload; Vite serves explicit navigation to completed generations',
    'Native DevTools discovery probes the absent Devframe metadata endpoint first; its actual 404 responses and console messages are retained',
  ],
};
await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/inspector-production-chromium.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.info(styleText('green', '✅ [vite-hosts/inspector/production]'), receipt);
