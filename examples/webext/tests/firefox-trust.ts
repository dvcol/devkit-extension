import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { styleText } from 'node:util';
import { By } from 'selenium-webdriver';
import { Context, Driver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';
import { startTimingServer } from './script-timing.ts';
import { createDeniedRequests, findTab, probeCaller, readDocument } from './trust-fixture.ts';

const extensionUuid = crypto.randomUUID();
const options = new Options()
  .addArguments('-headless')
  .setPreference(
    'extensions.webextensions.uuids',
    JSON.stringify({ 'devkit-native-port@example.invalid': extensionUuid }),
  );
if (process.env.FIREFOX_BINARY !== undefined) options.setBinary(process.env.FIREFOX_BINARY);
const driver = Driver.createSession(
  options,
  new ServiceBuilder().addArguments('--allow-system-access').build(),
);
try {
  await using cleanup = new AsyncDisposableStack();
  await mkdir('artifacts/trust', { recursive: true });
  const server = await startTimingServer();
  cleanup.defer(server.close);
  await driver.manage().setTimeouts({ script: 10_000 });
  await driver.installAddon(resolve('dist/firefox'), true);
  await driver.get(`moz-extension://${extensionUuid}/panel.html`);
  const extension = await driver.getWindowHandle();
  await waitText('#status', 'Connected');
  await waitText('#permission-status', 'Not granted');
  await driver.switchTo().newWindow('tab');
  const source = await driver.getWindowHandle();
  await driver.get(`${server.url}index.html`);
  await driver.switchTo().window(extension);
  const tabId = await driver.executeScript<number>(findTab, `${server.url}index.html`);
  const messages = await createDeniedRequests();
  assert.ok(messages.length >= 2);
  assert.deepEqual(
    await driver.executeScript(probeCaller, { name: 'wrong-channel', messages }),
    [],
  );
  assert.deepEqual(
    await driver.executeScript(probeCaller, {
      tabId,
      name: 'devkit-native-port-example',
      messages,
    }),
    [],
  );
  await waitText('#catalog', 'active');
  await driver.findElement(By.id('routed')).click();
  await waitText('#result', '1');
  const document = await driver.executeScript<Awaited<ReturnType<typeof readDocument>>>(
    readDocument,
    { tabId, frameIds: [0] },
  );
  assert.equal(document.runtime, 'undefined');
  await driver.switchTo().window(source);
  await driver.navigate().refresh();
  await driver.switchTo().window(extension);
  await assert.rejects(
    driver.executeScript(readDocument, { tabId, documentIds: [document.documentId] }),
  );
  const replacement = await driver.executeScript<Awaited<ReturnType<typeof readDocument>>>(
    readDocument,
    { tabId, frameIds: [0] },
  );
  assert.notEqual(replacement.documentId, document.documentId);
  const optionalUrl = new URL(`${server.url}index.html`);
  optionalUrl.hostname = 'localhost';
  await driver.switchTo().window(source);
  await driver.get(optionalUrl.href);
  await driver.switchTo().window(extension);
  const target = { tabId, frameIds: [0] };
  await assert.rejects(driver.executeScript(readDocument, target));
  await requestPermission(false);
  await waitText('#permission-result', 'Access denied');
  await waitText('#permission-status', 'Not granted');
  await assert.rejects(driver.executeScript(readDocument, target));
  await requestPermission(true);
  await waitText('#permission-result', 'Access granted');
  await waitText('#permission-status', 'Granted');
  const granted = await driver.executeScript<Awaited<ReturnType<typeof readDocument>>>(
    readDocument,
    target,
  );
  assert.ok(granted.documentId);
  assert.equal(granted.title, document.title);
  await driver.switchTo().newWindow('tab');
  const peer = await driver.getWindowHandle();
  await driver.get(`moz-extension://${extensionUuid}/panel.html`);
  await waitText('#permission-status', 'Granted');
  await driver.switchTo().window(extension);
  await driver.findElement(By.id('permission-remove')).click();
  await waitText('#permission-result', 'Access removed');
  await waitText('#permission-status', 'Not granted');
  await assert.rejects(driver.executeScript(readDocument, target));
  await driver.switchTo().window(peer);
  await waitText('#permission-status', 'Not granted');
  await driver.switchTo().window(extension);
  await requestPermission(true);
  await waitText('#permission-status', 'Granted');
  const restored = await driver.executeScript<Awaited<ReturnType<typeof readDocument>>>(
    readDocument,
    target,
  );
  assert.equal(restored.documentId, granted.documentId);
  await driver.switchTo().window(peer);
  await waitText('#permission-status', 'Granted');
  const receipt = {
    browser: (await driver.getCapabilities()).getBrowserVersion(),
    checks: [
      'wrong channel and forged content sender reject native action/state requests without replies',
      'admitted panel retains working service after denied disable request',
      'MAIN cannot connect to extension runtime',
      'stale documentId rejects after reload; current-document selection succeeds',
      'native optional-host prompt refusal resolves false and injection remains denied',
      'native prompt grant permits injection',
      'removing permission rejects next injection on the same tab',
      'regrant permits the same native operation without reconnect or replay',
      'native permission events update a second open extension page',
    ],
  };
  await writeFile('artifacts/trust/firefox.json', JSON.stringify(receipt, null, 2));
  console.info(styleText('green', '✅ [trust/firefox]'), receipt);
} finally {
  await driver.quit();
}

async function waitText(selector: string, value: string): Promise<void> {
  await driver.wait(
    async () => (await driver.findElement(By.css(selector)).getText()) === value,
    10_000,
    `${selector} did not show ${value}`,
  );
}

/** Click Firefox's real notification, without overriding the permissions API or stored grants. */
async function requestPermission(grant: boolean): Promise<void> {
  await driver.findElement(By.id('permission-request')).click();
  await driver.setContext(Context.CHROME);
  try {
    const selector = grant
      ? '.popup-notification-primary-button'
      : '.popup-notification-secondary-button';
    const notification = By.css(`#addon-webext-permissions-notification ${selector}`);
    await driver.wait(async () => (await driver.findElements(notification)).length > 0, 10_000);
    await driver.wait(
      () =>
        driver.executeScript(
          'return document.querySelector("#notification-popup").state === "open"',
        ),
      10_000,
      'Native permission prompt did not finish opening',
    );
    const button = driver.findElement(notification);
    await driver.wait(
      () => button.isDisplayed(),
      10_000,
      'Native permission button is not visible',
    );
    await driver.wait(() => button.isEnabled(), 10_000, 'Native permission button is disabled');
    await driver.actions().move({ origin: button }).click().perform();
  } finally {
    await driver.setContext(Context.CONTENT);
  }
}
