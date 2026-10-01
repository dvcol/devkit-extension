import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { styleText } from 'node:util';
import { By, until } from 'selenium-webdriver';
import { Driver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';
import type { ProviderDescriptor } from '@devkit/core';

const key = process.env.VITE_COUNTER_STORAGE_KEY;
assert.ok(key !== undefined && key !== '', 'Use the same VITE_COUNTER_STORAGE_KEY as the build');
const extensionUuid = crypto.randomUUID();
const origin = `moz-extension://${extensionUuid}`;
const options = new Options()
  .addArguments('-headless')
  .setPreference(
    'extensions.webextensions.uuids',
    JSON.stringify({ 'devkit-native-port@example.invalid': extensionUuid }),
  );
if (process.env.FIREFOX_BINARY !== undefined) options.setBinary(process.env.FIREFOX_BINARY);
const service = new ServiceBuilder().addArguments('--allow-system-access');
const driver = Driver.createSession(options, service.build());
try {
  await mkdir('artifacts/persistence', { recursive: true });
  const launcher = await driver.getWindowHandle();
  await driver.installAddon(resolve('dist/firefox-persistent'), true);
  const first = await openPanel();
  await connected(0);
  assert.equal(
    await driver.executeScript(
      'return chrome.runtime.getManifest().permissions.includes("storage")',
    ),
    true,
  );
  const previous = await provider();
  const second = await openPanel();
  await connected(0);
  assert.deepEqual(await provider(), previous);
  await increase();
  await checkPeers([first, second], 1);
  await saved(key, 1);
  await driver.findElement(By.id('write')).click();
  await checkPeers([first, second], 10);
  await saved(key, 10);
  const independentKey = `${key}.independent`;
  await driver.executeScript(
    'return chrome.storage.local.set({ [arguments[0]]: { value: 44 } })',
    independentKey,
  );
  await completeDiagnosticAction(first, second);
  await reload([first, second], launcher);
  const replacementFirst = await openPanel();
  await connected(10);
  const replacement = await provider();
  assert.equal(replacement.id, previous.id);
  assert.deepEqual(replacement.realm, previous.realm);
  assert.notEqual(replacement.incarnation, previous.incarnation);
  const replacementSecond = await openPanel();
  await connected(10);
  assert.deepEqual(await provider(), replacement);
  await increase();
  await checkPeers([replacementFirst, replacementSecond], 11);
  await saved(key, 11);
  assert.deepEqual(await readRecord(independentKey), { value: 44 });
  await driver.findElement(By.id('executions')).click();
  await waitText('#result', '{"started":0,"completed":0}');
  await management('Counter storage: Wrote counter 11');
  await writeFile('artifacts/persistence/firefox.png', await driver.takeScreenshot(), 'base64');
  const receipt = {
    browser: (await driver.getCapabilities()).getBrowserVersion(),
    storageKey: key,
    lifecycle: 'chrome.runtime.reload()',
    oldExtensionTabsClosed: 2,
    previous,
    replacement,
    confirmedBeforeReload: { value: 10 },
    restored: 10,
    nextValue: 11,
    independentValue: 44,
    executionsBeforeReload: { started: 1, completed: 1 },
    executions: { started: 0, completed: 0 },
    checks: [
      'two Firefox native clients share action and native-state updates written to storage.local',
      'explicit native extension reload closes both old tabs and restores the saved counter under a fresh provider incarnation',
      'fresh Firefox clients each mount one counter and management view and share one action effect',
      'a separate storage key remains unchanged and diagnostic execution state stays ephemeral',
    ],
    limitations: [
      'Explicit extension reload after a confirmed write, not natural event-page suspension or browser restart',
      'Native writes are asynchronous; action completion is not durable storage acknowledgement',
      'Firefox quota and interrupted-write behavior are not exercised',
      'No global page-error capture through WebDriver Classic',
    ],
  };
  await writeFile('artifacts/persistence/firefox.json', JSON.stringify(receipt, null, 2));
  console.info(styleText('green', '✅ [webext/firefox-persistence]'), receipt);
} finally {
  await driver.quit();
}

async function openPanel(): Promise<string> {
  await driver.switchTo().newWindow('tab');
  const handle = await driver.getWindowHandle();
  await driver.get(`${origin}/panel.html`);
  return handle;
}

async function connected(value: number): Promise<void> {
  await waitText('#status', 'Connected');
  await waitText('#catalog', 'active');
  await counter(value);
  for (const id of ['renderer', 'management']) {
    const root = await driver.findElement(By.id(id)).getShadowRoot();
    assert.equal((await root.findElements(By.css('.devframes-json-render-scroll-root'))).length, 1);
  }
}

async function checkPeers(handles: readonly string[], value: number): Promise<void> {
  for (const handle of handles) {
    await driver.switchTo().window(handle);
    await counter(value);
  }
}

async function counter(value: number): Promise<void> {
  const root = await driver.findElement(By.id('renderer')).getShadowRoot();
  const content = await root.findElement(By.css('.devframes-json-render-scroll-root'));
  await driver.wait(
    until.elementTextMatches(content, new RegExp(`Counter: ${value}\\b`, 'u')),
    30_000,
  );
}

async function increase(): Promise<void> {
  const root = await driver.findElement(By.id('renderer')).getShadowRoot();
  const button = await root.findElement(By.css('button'));
  await button.click();
}

async function completeDiagnosticAction(first: string, second: string): Promise<void> {
  await driver.switchTo().window(first);
  await driver.findElement(By.id('wait')).click();
  await driver.switchTo().window(second);
  await driver.findElement(By.id('executions')).click();
  await waitText('#result', '{"started":1,"completed":0}');
  await driver.findElement(By.id('release')).click();
  await driver.findElement(By.id('executions')).click();
  await waitText('#result', '{"started":1,"completed":1}');
}

async function provider(): Promise<ProviderDescriptor> {
  const value: unknown = JSON.parse(await driver.findElement(By.id('provider')).getText());
  assert.ok(typeof value === 'object' && value !== null);
  assert.ok('id' in value && typeof value.id === 'string');
  assert.ok('incarnation' in value && typeof value.incarnation === 'string');
  assert.ok('realm' in value && typeof value.realm === 'object' && value.realm !== null);
  assert.ok('id' in value.realm && typeof value.realm.id === 'string');
  return { id: value.id, incarnation: value.incarnation, realm: { id: value.realm.id } };
}

function readRecord(storageKey: string): Promise<unknown> {
  return driver.executeScript(
    'return chrome.storage.local.get(arguments[0]).then(record => record[arguments[0]])',
    storageKey,
  );
}

async function saved(storageKey: string, value: number): Promise<void> {
  await driver.wait(
    async () => JSON.stringify(await readRecord(storageKey)) === JSON.stringify({ value }),
    30_000,
  );
}

async function waitText(selector: string, expected: string): Promise<void> {
  await driver.wait(
    () =>
      driver.executeScript(
        'return document.querySelector(arguments[0])?.textContent === arguments[1]',
        selector,
        expected,
      ),
    30_000,
  );
}

async function management(expected: string): Promise<void> {
  const root = await driver.findElement(By.id('management')).getShadowRoot();
  const content = await root.findElement(By.css('.devframes-json-render-scroll-root'));
  await driver.wait(until.elementTextContains(content, expected), 30_000);
}

async function reload(handles: readonly string[], launcher: string): Promise<void> {
  await driver.executeScript('chrome.runtime.reload()');
  await driver.wait(async () => {
    const current = await driver.getAllWindowHandles();
    return handles.every((handle) => !current.includes(handle));
  }, 30_000);
  await driver.switchTo().window(launcher);
}
