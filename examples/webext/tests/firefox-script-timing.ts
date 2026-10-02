import assert from 'node:assert/strict';
import type { Browser } from '@wxt-dev/browser';
import { writeFile } from 'node:fs/promises';
import type { Driver } from 'selenium-webdriver/firefox.js';
import { By } from 'selenium-webdriver';
import {
  checkTimingRegistration,
  checkTimingInstallation,
  checkTimingSnapshot,
  readTimingSnapshot,
  readUnmatchedMarkers,
  readTimingRegistration,
  startTimingServer,
} from './script-timing.ts';

interface TimingPage {
  readonly extension: string;
  readonly source: string;
  readonly url: string;
  readonly world: `${Browser.scripting.ExecutionWorld}`;
}

export async function checkFirefoxScriptTiming(
  driver: Driver,
  artifactDirectory: string,
): Promise<void> {
  await using cleanup = new AsyncDisposableStack();
  const { url, close } = await startTimingServer();
  cleanup.defer(close);
  const extension = await driver.getWindowHandle();
  await driver.switchTo().newWindow('tab');
  const source = await driver.getWindowHandle();
  cleanup.defer(async () => {
    await driver.switchTo().window(source);
    await driver.close();
    await driver.switchTo().window(extension);
  });
  const observations = [];
  const checks = [];
  for (const world of ['MAIN', 'ISOLATED'] as const) {
    observations.push(await checkWorld(driver, { extension, source, url, world }));
    checks.push(`${world}: script contribution install disable enable dispose and native timing`);
  }
  await driver.switchTo().window(source);
  await driver.get(`${url}index.html`);
  observations.push(checkTimingSnapshot(await driver.executeScript(readTimingSnapshot)));
  await driver.switchTo().window(extension);
  await writeFile(
    `${artifactDirectory}/script-timing.json`,
    JSON.stringify(
      { browser: (await driver.getCapabilities()).getBrowserVersion(), observations, checks },
      null,
      2,
    ),
  );
}

async function checkWorld(driver: Driver, page: TimingPage) {
  await driver.switchTo().window(page.extension);
  const installed = await control(driver, `script-${page.world.toLowerCase()}`, 'ready', 1);
  try {
    const registration =
      await driver.executeScript<Browser.scripting.RegisteredContentScript[]>(
        readTimingRegistration,
      );
    checkTimingRegistration(registration, page.world);
    await driver.switchTo().window(page.source);
    await driver.get(`${page.url}index.html`);
    const observation = checkTimingSnapshot(
      await driver.executeScript(readTimingSnapshot),
      page.world,
    );
    const lifecycle = await checkLifecycle(driver, page);
    await driver.get(page.url);
    assert.deepEqual(await driver.executeScript(readUnmatchedMarkers), {
      global: false,
      listener: null,
    });
    return { ...observation, lifecycle: { installed, ...lifecycle } };
  } finally {
    await driver.switchTo().window(page.extension);
    await control(driver, 'script-dispose', 'disposed');
    assert.deepEqual(await driver.executeScript(readTimingRegistration), []);
  }
}

async function control(driver: Driver, identifier: string, status: string, generation?: number) {
  await driver.findElement(By.id(identifier)).click();
  const output = driver.findElement(By.id('result'));
  await driver.wait(async () => (await output.getText()) !== 'Pending', 10_000);
  const snapshot: unknown = JSON.parse(await output.getText());
  checkTimingInstallation(snapshot, status, generation);
  return snapshot;
}

async function checkLifecycle(driver: Driver, page: TimingPage) {
  await driver.switchTo().window(page.extension);
  const disabled = await control(driver, 'script-disable', 'disabled', 1);
  assert.deepEqual(await driver.executeScript(readTimingRegistration), []);
  await driver.switchTo().window(page.source);
  assert.deepEqual(await driver.executeScript(readUnmatchedMarkers), {
    global: page.world === 'MAIN',
    listener: 'loading',
  });
  await driver.navigate().refresh();
  checkTimingSnapshot(await driver.executeScript(readTimingSnapshot));
  await driver.switchTo().window(page.extension);
  const enabled = await control(driver, 'script-enable', 'ready', 2);
  checkTimingRegistration(
    await driver.executeScript<Browser.scripting.RegisteredContentScript[]>(readTimingRegistration),
    page.world,
  );
  await driver.switchTo().window(page.source);
  await driver.navigate().refresh();
  checkTimingSnapshot(await driver.executeScript(readTimingSnapshot), page.world);
  return { disabled, enabled };
}
