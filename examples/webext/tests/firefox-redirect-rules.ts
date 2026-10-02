import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { By } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';
import {
  checkNativeRedirectRules,
  readNativeRedirects,
  startRedirectServer,
} from './redirect-rules.ts';

export async function checkFirefoxRedirectRules(driver: Driver, artifactDirectory: string) {
  await using cleanup = new AsyncDisposableStack();
  const fixture = await startRedirectServer();
  cleanup.defer(fixture.close);
  const extension = await driver.getWindowHandle();
  const provider = await driver.findElement(By.id('provider')).getText();
  await driver.switchTo().newWindow('tab');
  const source = await driver.getWindowHandle();
  cleanup.defer(async () => {
    await driver.switchTo().window(source);
    await driver.close();
    await driver.switchTo().window(extension);
  });
  await driver.get(fixture.url);
  const observation = await checkNativeRedirectRules({
    control: async (identifier) => {
      await driver.switchTo().window(extension);
      await driver.findElement(By.id(identifier)).click();
      await driver.wait(
        async () => (await driver.findElement(By.id('result')).getText()) !== 'Pending',
        10_000,
      );
      const snapshot: unknown = JSON.parse(await driver.findElement(By.id('result')).getText());
      return snapshot;
    },
    observe: async () => {
      await driver.switchTo().window(source);
      return driver.executeScript(readNativeRedirects);
    },
    requests: fixture.requests,
  });
  await driver.switchTo().window(extension);
  assert.equal(await driver.findElement(By.id('provider')).getText(), provider);
  await writeFile(
    `${artifactDirectory}/redirect-rules.json`,
    JSON.stringify(
      {
        browser: (await driver.getCapabilities()).getBrowserVersion(),
        checks: observation.checks,
        observation,
        serverRequests: fixture.requests,
        providerRetained: true,
        limitations: ['No global page-error capture through WebDriver Classic'],
      },
      null,
      2,
    ) + '\n',
  );
}
