import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import type { createRemoteHost } from '@devkit/example-server-contexts';
import { By, until } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';
import { publishCounterView } from './json-view-fixture.ts';

type ServerHost = Awaited<ReturnType<typeof createRemoteHost>>;

export async function checkFirefoxViews(
  driver: Driver,
  devframe: ServerHost,
  devtools: ServerHost,
): Promise<() => void> {
  using cleanup = new DisposableStack();
  const first = await publishCounterView(devframe);
  cleanup.defer(first.dispose);
  const second = await publishCounterView(devtools);
  cleanup.defer(second.dispose);
  assert.equal(first.view.ref.stateKey, second.view.ref.stateKey);
  await viewText(driver, 'example.devframe', 3);
  await viewText(driver, 'example.devtools', 3);
  first.dispose();
  await driver.wait(
    async () =>
      (await driver.findElements(By.css('[data-provider="example.devframe"] [data-view]')))
        .length === 0,
    10_000,
  );
  const replacement = await publishCounterView(devframe);
  cleanup.defer(replacement.dispose);
  await viewText(driver, 'example.devframe', 3);
  const root = await driver
    .findElement(By.css('[data-provider="example.devframe"] [data-view]'))
    .getShadowRoot();
  const button = await root.findElement(By.css('button'));
  await button.click();
  await viewText(driver, 'example.devframe', 4);
  await viewText(driver, 'example.devtools', 3);
  assert.equal(
    (await driver.findElements(By.css('[data-provider="example.devframe"] [data-view]'))).length,
    1,
  );
  await writeFile('artifacts/firefox/json-views.png', await driver.takeScreenshot(), 'base64');
  const lifetime = cleanup.move();
  return () => {
    lifetime.dispose();
  };
}

export async function viewText(driver: Driver, providerId: string, value: number): Promise<void> {
  const selector = `[data-provider="${providerId}"] [data-view]`;
  await driver.wait(until.elementLocated(By.css(selector)), 10_000);
  const root = await driver.findElement(By.css(selector)).getShadowRoot();
  const content = await root.findElement(By.css('.devframes-json-render-scroll-root'));
  await driver.wait(
    until.elementTextMatches(content, new RegExp(`Remote: ${value}\\b`, 'u')),
    10_000,
  );
}
