import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { By } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';
import { checkNativeHeaderRules, readNativeHeaders, startHeaderServer } from './header-rules.ts';

export async function checkFirefoxHeaderRules(driver: Driver, artifactDirectory: string) {
  await using cleanup = new AsyncDisposableStack();
  const fixture = await startHeaderServer();
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
  const observation = await checkNativeHeaderRules({
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
      return driver.executeScript(readNativeHeaders);
    },
  });
  await driver.switchTo().window(extension);
  assert.equal(await driver.findElement(By.id('provider')).getText(), provider);
  await writeFile(
    `${artifactDirectory}/header-rules.json`,
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
