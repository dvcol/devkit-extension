import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { By, until } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';
import type { Browser } from '@wxt-dev/browser';
import { scriptDocument, timingRegistrations, updateTimingScript } from './script-reload.ts';
import {
  checkTimingRegistration,
  checkTimingSnapshot,
  registerTimingScript,
  startTimingServer,
  unregisterTimingScript,
} from './script-timing.ts';

type ScriptDocument = ReturnType<typeof scriptDocument>;

export async function checkFirefoxScriptReload(driver: Driver, fixture: string): Promise<void> {
  await using cleanup = new AsyncDisposableStack();
  const { url, close } = await startTimingServer();
  cleanup.defer(close);
  const extension = await driver.getWindowHandle();
  const extensionUrl = await driver.getCurrentUrl();
  const previousProvider = await driver.findElement(By.css('#provider')).getText();
  checkTimingRegistration(
    await driver.executeScript<Browser.scripting.RegisteredContentScript[]>(
      registerTimingScript,
      'MAIN',
    ),
    'MAIN',
  );
  await driver.switchTo().newWindow('tab');
  const source = await driver.getWindowHandle();
  await driver.get(`${url}index.html`);
  const before = await driver.executeScript<ScriptDocument>(scriptDocument);
  checkTimingSnapshot(before.firstScript, 'MAIN');
  assert.equal(before.revision, null);
  await updateTimingScript(fixture);
  await driver.wait(async () => !(await driver.getAllWindowHandles()).includes(extension), 30_000);
  const oldDocument = await driver.executeScript<ScriptDocument>(scriptDocument);
  assert.deepEqual(oldDocument, before);
  const replacement = await openReplacement(driver, extensionUrl, previousProvider);
  cleanup.defer(async () => {
    await driver.switchTo().window(source);
    await driver.close();
    await driver.switchTo().window(replacement);
  });
  assert.deepEqual(await driver.executeScript(timingRegistrations), []);
  const freshDocuments = await checkFreshDocuments(driver, {
    extension: replacement,
    source,
    url: `${url}index.html`,
  });
  const browser = (await driver.getCapabilities()).getBrowserVersion();
  const receipt = { browser, before, oldDocument, ...freshDocuments };
  await writeFile(
    'artifacts/firefox-development/script-reload.json',
    JSON.stringify(receipt, null, 2),
  );
}

async function openReplacement(driver: Driver, url: string, previousProvider: string) {
  await driver.switchTo().newWindow('tab');
  const replacement = await driver.getWindowHandle();
  await driver.get(url);
  await driver.wait(
    until.elementTextIs(driver.findElement(By.css('#status')), 'Connected'),
    30_000,
  );
  assert.notEqual(await driver.findElement(By.css('#provider')).getText(), previousProvider);
  return replacement;
}

async function checkFreshDocuments(
  driver: Driver,
  page: { extension: string; source: string; url: string },
) {
  await driver.switchTo().window(page.source);
  await driver.get(page.url);
  const unregistered = await driver.executeScript<ScriptDocument>(scriptDocument);
  checkTimingSnapshot(unregistered.firstScript);
  assert.equal(unregistered.revision, null);
  await driver.switchTo().window(page.extension);
  const registration = await driver.executeScript<Browser.scripting.RegisteredContentScript[]>(
    registerTimingScript,
    'MAIN',
  );
  try {
    checkTimingRegistration(registration, 'MAIN');
    await driver.switchTo().window(page.source);
    await driver.get(page.url);
    const registered = await driver.executeScript<ScriptDocument>(scriptDocument);
    checkTimingSnapshot(registered.firstScript, 'MAIN');
    assert.equal(registered.revision, 'updated');
    return { unregistered, registered };
  } finally {
    await driver.switchTo().window(page.extension);
    assert.deepEqual(await driver.executeScript(unregisterTimingScript), []);
  }
}
