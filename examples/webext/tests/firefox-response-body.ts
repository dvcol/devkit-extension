import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { By } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';
import {
  checkFirefoxResponseBody as checkNativeFirefoxResponseBody,
  finishNativeResponse,
  readNativeResponse,
  startNativeResponse,
  startResponseServer,
} from './response-body.ts';

/** Running-background filtering only; this setup-time listener does not prove idle wakeup. */
export async function checkFirefoxResponseBody(driver: Driver, artifactDirectory: string) {
  await using cleanup = new AsyncDisposableStack();
  const fixture = await startResponseServer();
  cleanup.defer(fixture.close);
  const extension = await driver.getWindowHandle();
  const provider = await driver.findElement(By.id('provider')).getText();
  const permissions = await driver.executeScript<{ permissions: string[] }>(() =>
    chrome.permissions.getAll(),
  );
  for (const permission of ['webRequest', 'webRequestBlocking', 'webRequestFilterResponse'])
    assert.ok(permissions.permissions.includes(permission));
  await driver.switchTo().newWindow('tab');
  const source = await driver.getWindowHandle();
  cleanup.defer(async () => {
    await driver.switchTo().window(source);
    await driver.close();
    await driver.switchTo().window(extension);
  });
  await driver.get(fixture.url);
  const observation = await checkNativeFirefoxResponseBody(
    createResponseBrowser(driver, extension, source),
    fixture,
  );
  await driver.switchTo().window(extension);
  assert.equal(await driver.findElement(By.id('provider')).getText(), provider);
  await writeFile(
    `${artifactDirectory}/response-body.json`,
    JSON.stringify(
      {
        browser: (await driver.getCapabilities()).getBrowserVersion(),
        checks: observation.checks,
        observation,
        permissions,
        providerRetained: true,
        limitations: [
          'Running background only; idle wakeup is unproved',
          'No global page-error capture through WebDriver Classic',
        ],
      },
      null,
      2,
    ) + '\n',
  );
}

function createResponseBrowser(driver: Driver, extension: string, source: string) {
  async function control(operation: 'install' | 'disable' | 'enable' | 'dispose' | 'snapshot') {
    await driver.switchTo().window(extension);
    await driver.findElement(By.id(`response-${operation}`)).click();
    await driver.wait(
      async () => (await driver.findElement(By.id('result')).getText()) !== 'Pending',
      10_000,
    );
    const snapshot: unknown = JSON.parse(await driver.findElement(By.id('result')).getText());
    return snapshot;
  }
  return {
    control,
    read: async (path: string) => {
      await driver.switchTo().window(source);
      return driver.executeScript(readNativeResponse, path);
    },
    start: async (path: string, expected: string) => {
      await driver.switchTo().window(source);
      return driver.executeScript(startNativeResponse, path, expected);
    },
    finish: async () => {
      await driver.switchTo().window(source);
      return driver.executeScript(finishNativeResponse);
    },
    waitForError: () =>
      driver.wait(async () => {
        const snapshot = await control('snapshot');
        if (
          typeof snapshot !== 'object' ||
          snapshot === null ||
          !('errors' in snapshot) ||
          !Array.isArray(snapshot.errors) ||
          snapshot.errors.length === 0
        )
          return false;
        return snapshot;
      }, 10_000),
  };
}
