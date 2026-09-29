import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { styleText } from 'node:util';
import { By, until } from 'selenium-webdriver';
import { Driver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';
import { checkFirefoxServers } from './firefox-servers.ts';
import { checkFirefoxSelectedPage } from './firefox-selected-page.ts';
import { nativeSurfaceScript } from './native-surfaces.ts';
import { checkFirefoxDevtools } from './firefox-devtools.ts';

const extensionUuid = crypto.randomUUID();
const options = new Options()
  .addArguments('-headless')
  .setPreference(
    'extensions.webextensions.uuids',
    JSON.stringify({ 'devkit-native-port@example.invalid': extensionUuid }),
  );
if (process.env.FIREFOX_BINARY !== undefined) options.setBinary(process.env.FIREFOX_BINARY);
/** Firefox requires this native automation flag to inspect moz-extension documents. */
const service = new ServiceBuilder().addArguments('--allow-system-access');
const driver = Driver.createSession(options, service.build());
const origin = `moz-extension://${extensionUuid}`;

try {
  await driver.installAddon(resolve('dist/firefox'), true);
  await driver.get(`${origin}/denied.html`);
  const launcher = await driver.getWindowHandle();
  await driver.executeScript('return chrome.runtime.openOptionsPage()');
  await driver.wait(async () => (await driver.getAllWindowHandles()).length === 2, 10_000);
  const optionsPage = (await driver.getAllWindowHandles()).find((handle) => handle !== launcher);
  assert.ok(optionsPage !== undefined);
  await driver.close();
  await driver.switchTo().window(optionsPage);
  const first = await driver.getWindowHandle();
  await connected(0);
  const provider = await text('#provider');
  await driver.switchTo().newWindow('tab');
  const second = await driver.getWindowHandle();
  await driver.get(`${origin}/panel.html`);
  await connected(0);
  assert.equal(await text('#provider'), provider);
  await increase();
  await counter(1);
  await click('#identity');
  await contains('#result', 'panel.html');
  const identity = await text('#result');
  await driver.switchTo().window(first);
  await counter(1);
  await click('#identity');
  await contains('#result', 'panel.html');
  assert.notEqual(await text('#result'), identity);
  await checkNativeValues(second);
  await checkDisconnect(first, second, provider);
  await checkRouting(first, second);
  await driver.switchTo().window(first);
  await checkFirefoxServers(driver);
  await checkFirefoxSelectedPage(driver);
  await checkDeniedPage();
  await driver.switchTo().window(second);
  await click('#remote-close');
  await waitText('#status', 'Disconnected');
  await contains('#result', 'closed');
  await driver.switchTo().window(first);
  await waitText('#status', 'Connected');
  await click('#capability');
  await waitText('#result', '16');
  await driver.manage().setTimeouts({ script: 60_000 });
  const surfaceResult = await driver.executeAsyncScript<{ checks?: string[]; error?: string }>(
    `const done = arguments[arguments.length - 1]; ${nativeSurfaceScript}
checkNativeSurfaces().then(checks => done({ checks }), error => done({ error: error.stack ?? String(error) }));`,
  );
  assert.equal(surfaceResult.error, undefined);
  assert.ok(surfaceResult.checks !== undefined);
  const devtoolsChecks = await checkFirefoxDevtools(driver);
  await saveEvidence([...surfaceResult.checks, ...devtoolsChecks]);
} catch (error) {
  const result = await text('#server-result').catch(() => 'Extension page unavailable');
  console.error(styleText('red', '❌ [webext/firefox]'), result);
  throw error;
} finally {
  await driver.quit();
}

async function checkNativeValues(peer: string): Promise<void> {
  await click('#write');
  await counter(10);
  await click('#rich');
  await waitText('#result', 'true');
  await click('#unsupported');
  await contains('#result', 'serialize');
  await driver.switchTo().window(peer);
  await counter(10);
}

async function checkDisconnect(first: string, second: string, provider: string): Promise<void> {
  await driver.switchTo().window(first);
  await click('#wait');
  await driver.switchTo().window(second);
  await click('#executions');
  await waitText('#result', '{"started":1,"completed":0}');
  await driver.switchTo().window(first);
  await click('#disconnect');
  await waitText('#status', 'Disconnected');
  await contains('#result', 'closed');
  await driver.wait(
    () =>
      driver.executeScript<boolean>(
        'return !document.querySelector("#renderer").shadowRoot?.querySelector("button")',
      ),
    10_000,
  );
  await driver.switchTo().window(second);
  await click('#release');
  await click('#executions');
  await waitText('#result', '{"started":1,"completed":1}');
  await driver.switchTo().window(first);
  await driver.navigate().refresh();
  await connected(10);
  assert.equal(await text('#provider'), provider);
  await click('#executions');
  await waitText('#result', '{"started":1,"completed":1}');
  await increase();
  await counter(11);
  await driver.switchTo().window(second);
  await counter(11);
}

async function checkRouting(first: string, second: string): Promise<void> {
  await click('#routed');
  await waitText('#result', '12');
  await driver.switchTo().window(first);
  await click('#capability');
  await waitText('#result', '12');
  await click('#broadcast');
  await contains('#result', 'fulfilled');
  await counter(13);
  await driver.switchTo().window(second);
  await counter(13);
  await click('#disable-service');
  await waitText('#catalog', 'disabled');
  await driver.switchTo().window(first);
  await waitText('#catalog', 'disabled');
  await click('#routed');
  await contains('#result', 'No currently available provider');
  await click('#enable-service');
  await waitText('#catalog', 'active');
  await driver.switchTo().window(second);
  await waitText('#catalog', 'active');
  await click('#routed');
  await waitText('#result', '14');
}

async function checkDeniedPage(): Promise<void> {
  await driver.switchTo().newWindow('tab');
  await driver.get(`${origin}/denied.html`);
  await waitText('#status', 'Disconnected');
  await contains('#result', 'closed');
  assert.equal(
    await driver.executeScript<boolean>(
      'return !!document.querySelector("#renderer").shadowRoot?.querySelector("button")',
    ),
    false,
  );
  await driver.close();
}

async function connected(value: number): Promise<void> {
  await waitText('#status', 'Connected');
  await waitText('#catalog', 'active');
  await counter(value);
}

async function click(selector: string): Promise<void> {
  await driver.findElement(By.css(selector)).click();
}

async function increase(): Promise<void> {
  const root = await driver.findElement(By.css('#renderer')).getShadowRoot();
  const button = await root.findElement(By.css('button'));
  await button.click();
}

async function counter(value: number): Promise<void> {
  const root = await driver.findElement(By.css('#renderer')).getShadowRoot();
  const content = await root.findElement(By.css('.devframes-json-render-scroll-root'));
  await driver.wait(
    until.elementTextMatches(content, new RegExp(`Counter: ${value}\\b`, 'u')),
    10_000,
  );
}

function text(selector: string): Promise<string> {
  return driver.findElement(By.css(selector)).getText();
}

async function waitText(selector: string, expected: string): Promise<void> {
  await driver.wait(until.elementTextIs(driver.findElement(By.css(selector)), expected), 10_000);
}

async function contains(selector: string, expected: string): Promise<void> {
  await driver.wait(
    until.elementTextContains(driver.findElement(By.css(selector)), expected),
    10_000,
  );
}

async function saveEvidence(surfaceChecks: string[]): Promise<void> {
  const receipt = {
    browser: (await driver.getCapabilities()).getBrowserVersion(),
    driver: 'Firefox WebDriver Classic',
    geckodriver: (await driver.getCapabilities()).get('moz:geckodriverVersion') as unknown,
    checks: [
      'two real Ports and distinct caller identities',
      'native JSON renderer action and shared state on both pages',
      'native state write and Map/BigInt round trip',
      'unsupported function rejects',
      'pending call rejects on disconnect and renderer unmounts',
      'backend completes once without replay after reconnect',
      'provider incarnation survives page reconnect',
      'portable action, capability and explicit routing',
      'broadcast and catalog disable/enable reach both pages',
      'denied packaged URL rejects and cleans up mount',
      'worker-initiated disconnect leaves peer usable',
      'native origin admission and authentication reject unauthorized connections',
      'isolated Devframe and DevTools connections coexist with the extension provider',
      'devserver-only and all-realm broadcast update the selected backends',
      'explicit provider preference, disconnect fallback and partial broadcast failure',
      'selected document publishes a real native connection and retains backend ownership after closing',
      'absent, malformed and closed selected documents reject without attaching',
      'native scripting permission rejects a tampered about:blank selection',
      ...surfaceChecks,
    ],
    limitations: ['No global page-error capture through WebDriver Classic'],
  };
  await mkdir('artifacts/firefox', { recursive: true });
  await writeFile(
    'artifacts/firefox/native-port-proof.png',
    await driver.takeScreenshot(),
    'base64',
  );
  await writeFile('artifacts/firefox/receipt.json', JSON.stringify(receipt, null, 2));
  console.info(styleText('green', '✅ [webext/firefox]'), receipt);
}
