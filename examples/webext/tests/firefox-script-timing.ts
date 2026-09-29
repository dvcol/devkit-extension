import assert from 'node:assert/strict';
import type { Browser } from '@wxt-dev/browser';
import { writeFile } from 'node:fs/promises';
import type { Driver } from 'selenium-webdriver/firefox.js';
import {
  checkTimingRegistration,
  checkTimingSnapshot,
  readTimingSnapshot,
  readUnmatchedMarkers,
  registerTimingScript,
  startTimingServer,
  unregisterTimingScript,
} from './script-timing.ts';

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
  for (const world of ['MAIN', 'ISOLATED'] as const) {
    observations.push(await checkWorld(driver, { extension, source, url, world }));
  }
  await driver.switchTo().window(source);
  await driver.get(`${url}index.html`);
  observations.push(checkTimingSnapshot(await driver.executeScript(readTimingSnapshot)));
  await driver.switchTo().window(extension);
  await writeFile(
    `${artifactDirectory}/script-timing.json`,
    JSON.stringify(
      { browser: (await driver.getCapabilities()).getBrowserVersion(), observations },
      null,
      2,
    ),
  );
}

async function checkWorld(
  driver: Driver,
  page: {
    extension: string;
    source: string;
    url: string;
    world: `${Browser.scripting.ExecutionWorld}`;
  },
) {
  await driver.switchTo().window(page.extension);
  const registration = await driver.executeScript<Browser.scripting.RegisteredContentScript[]>(
    registerTimingScript,
    page.world,
  );
  try {
    checkTimingRegistration(registration, page.world);
    await driver.switchTo().window(page.source);
    await driver.get(`${page.url}index.html`);
    const observation = checkTimingSnapshot(
      await driver.executeScript(readTimingSnapshot),
      page.world,
    );
    await driver.get(page.url);
    assert.deepEqual(await driver.executeScript(readUnmatchedMarkers), {
      global: false,
      listener: null,
    });
    return observation;
  } finally {
    await driver.switchTo().window(page.extension);
    assert.deepEqual(await driver.executeScript(unregisterTimingScript), []);
  }
}
