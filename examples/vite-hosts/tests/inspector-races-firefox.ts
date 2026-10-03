import { mkdir, writeFile } from 'node:fs/promises';
import { styleText } from 'node:util';
import { Driver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';
import { checkDisconnectedSender } from './inspector-race-firefox-actions.ts';
import { inspectorRaceServer } from './inspector-race-fixture.ts';

await using cleanup = new AsyncDisposableStack();
const devframe = await inspectorRaceServer('devframe');
cleanup.defer(devframe.close);
const devtools = await inspectorRaceServer('devtools');
cleanup.defer(devtools.close);
const options = new Options().addArguments('-headless');
if (process.env.FIREFOX_BINARY !== undefined) options.setBinary(process.env.FIREFOX_BINARY);
const driver = Driver.createSession(options, new ServiceBuilder().build());
cleanup.defer(() => driver.quit());
const capabilities = await driver.getCapabilities();
const observations = [
  await checkDisconnectedSender(driver, devframe, devtools),
  await checkDisconnectedSender(driver, devtools, devframe),
];
await cleanup.disposeAsync();
const receipt = {
  browser: capabilities.getBrowserVersion(),
  driver: capabilities.get('moz:geckodriverVersion') as unknown,
  observations,
  checks: [
    'the unchanged inspector action starts one real HTTP request on its pinned backend',
    'sender pagehide disconnects its native peer while a second peer and held backend fetch survive',
    'releasing the real response updates retained native state without changing provider incarnation',
    'the alternate host receives no new HTTP request or state change',
    'a fresh sender mount observes retained native state without replaying the inspection',
  ],
  limitations: [
    'The abandoned document promise is not inspected; only its actual pagehide and native disconnection are exercised',
    'No available fallback selector is configured; no replay or reroute is claimed beyond this pinned route',
    'Renderer replacement alone is not cancellation in the Vite inspector',
    'Remote caller loss does not cancel already-dispatched backend work or roll back state',
    'Firefox native development only; extension contexts and preview are not exercised',
    'No global page-error or browser-console capture through WebDriver Classic; visible native failures are asserted',
  ],
};
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/inspector-races-firefox.json', JSON.stringify(receipt, null, 2) + '\n');
console.info(styleText('green', '✅ [vite-hosts/inspector-races/firefox]'), receipt);
