import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { By } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';
import {
  checkFirefoxResponseBody as checkNativeFirefoxResponseBody,
  startResponseServer,
} from './response-body.ts';
import { checkNativeResponseCancellation } from './response-cancellation.ts';
import { createResponseBrowser } from './firefox-response-browser.ts';

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
  const browser = createResponseBrowser(driver, extension, source);
  const observation = await checkNativeFirefoxResponseBody(browser, fixture);
  const cancellation = await checkNativeResponseCancellation(browser, fixture);
  await driver.switchTo().window(extension);
  assert.equal(await driver.findElement(By.id('provider')).getText(), provider);
  await writeFile(
    `${artifactDirectory}/response-body.json`,
    JSON.stringify(
      {
        browser: (await driver.getCapabilities()).getBrowserVersion(),
        checks: [...observation.checks, ...cancellation.checks],
        observation,
        cancellation,
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
