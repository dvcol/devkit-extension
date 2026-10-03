import { mkdir, writeFile } from 'node:fs/promises';
import { styleText } from 'node:util';
import { Driver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';
import { checkInspectorProduction } from './inspector-production-firefox-actions.ts';

await using cleanup = new AsyncDisposableStack();
const options = new Options().addArguments('-headless');
if (process.env.FIREFOX_BINARY !== undefined) options.setBinary(process.env.FIREFOX_BINARY);
const driver = Driver.createSession(options, new ServiceBuilder().build());
cleanup.defer(() => driver.quit());
const capabilities = await driver.getCapabilities();
const observations = [];
for (const host of ['devframe', 'devtools'] as const)
  observations.push(await checkInspectorProduction(driver, host));
await cleanup.disposeAsync();
const receipt = {
  browser: capabilities.getBrowserVersion(),
  driver: capabilities.get('moz:geckodriverVersion') as unknown,
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
  limitations: [
    'No global page-error, browser-console or discovery-request capture through WebDriver Classic',
    'No automatic production-page reload; Vite serves explicit navigation to completed generations',
  ],
};
await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/inspector-production-firefox.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.info(styleText('green', '✅ [vite-hosts/inspector/production/firefox]'), receipt);
