import assert from 'node:assert/strict';
import { By, until } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';
import type { ProviderDescriptor } from '@devkit/core';

export async function openPanel(driver: Driver, origin: string, value: number) {
  await driver.switchTo().newWindow('tab');
  const handle = await driver.getWindowHandle();
  await driver.get(`${origin}/panel.html`);
  await waitText(driver, '#status', 'Connected');
  await waitText(driver, '#catalog', 'active');
  assert.equal(
    await driver.executeScript('return chrome.runtime.getURL("panel.html")'),
    `${origin}/panel.html`,
  );
  await counter(driver, value);
  for (const id of ['renderer', 'management']) {
    const root = await driver.findElement(By.id(id)).getShadowRoot();
    assert.equal((await root.findElements(By.css('.devframes-json-render-scroll-root'))).length, 1);
  }
  return {
    handle,
    timeOrigin: await driver.executeScript<number>('return performance.timeOrigin'),
  };
}

export async function readProvider(driver: Driver): Promise<ProviderDescriptor> {
  const value: unknown = JSON.parse(await driver.findElement(By.id('provider')).getText());
  assert.ok(typeof value === 'object' && value !== null);
  assert.ok('id' in value && typeof value.id === 'string');
  assert.ok('incarnation' in value && typeof value.incarnation === 'string');
  assert.ok('realm' in value && typeof value.realm === 'object' && value.realm !== null);
  assert.ok('id' in value.realm && typeof value.realm.id === 'string');
  return { id: value.id, incarnation: value.incarnation, realm: { id: value.realm.id } };
}

export async function readCaller(driver: Driver, origin: string) {
  await driver.findElement(By.id('identity')).click();
  await driver.wait(
    async () => (await driver.findElement(By.id('result')).getText()).startsWith('{'),
    30_000,
  );
  const value: unknown = JSON.parse(await driver.findElement(By.id('result')).getText());
  assert.ok(typeof value === 'object' && value !== null);
  assert.ok('id' in value && typeof value.id === 'number');
  assert.ok('url' in value && value.url === `${origin}/panel.html`);
  return { id: value.id, url: value.url };
}

export async function increase(driver: Driver): Promise<void> {
  const root = await driver.findElement(By.id('renderer')).getShadowRoot();
  const button = await root.findElement(By.css('button'));
  await button.click();
}

export async function checkPeers(
  driver: Driver,
  handles: readonly string[],
  value: number,
): Promise<void> {
  for (const handle of handles) {
    await driver.switchTo().window(handle);
    await counter(driver, value);
  }
}

export async function counter(driver: Driver, value: number): Promise<void> {
  const root = await driver.findElement(By.id('renderer')).getShadowRoot();
  const content = await root.findElement(By.css('.devframes-json-render-scroll-root'));
  await driver.wait(
    until.elementTextMatches(content, new RegExp(`Counter: ${value}\\b`, 'u')),
    30_000,
  );
}

export function readRecord(driver: Driver, storageKey: string): Promise<unknown> {
  return driver.executeScript(
    'return chrome.storage.local.get(arguments[0]).then(record => record[arguments[0]])',
    storageKey,
  );
}

export async function saved(driver: Driver, storageKey: string, value: number): Promise<void> {
  await driver.wait(
    async () => JSON.stringify(await readRecord(driver, storageKey)) === JSON.stringify({ value }),
    30_000,
  );
}

export async function waitText(driver: Driver, selector: string, expected: string): Promise<void> {
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

export async function completeDiagnosticAction(
  driver: Driver,
  first: string,
  second: string,
): Promise<void> {
  await driver.switchTo().window(first);
  await driver.findElement(By.id('wait')).click();
  await driver.switchTo().window(second);
  await driver.findElement(By.id('executions')).click();
  await waitText(driver, '#result', '{"started":1,"completed":0}');
  await driver.findElement(By.id('release')).click();
  await driver.findElement(By.id('executions')).click();
  await waitText(driver, '#result', '{"started":1,"completed":1}');
}
