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
  await retainViewButton(driver, 'example.devframe');
  first.dispose();
  await driver.wait(
    async () =>
      (await driver.findElements(By.css('[data-provider="example.devframe"] [data-view]')))
        .length === 0,
    10_000,
  );
  await clickRetainedViewButton(driver);
  const replacement = await publishCounterView(devframe);
  cleanup.defer(replacement.dispose);
  await viewText(driver, 'example.devframe', 3);
  await clickView(driver, 'example.devframe');
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

export async function clickView(driver: Driver, providerId: string): Promise<void> {
  const root = await driver
    .findElement(By.css(`[data-provider="${providerId}"] [data-view]`))
    .getShadowRoot();
  const button = await root.findElement(By.css('button'));
  await button.click();
}

/** Keep the DOM node in the page because WebDriver rejects detached element references. */
export async function retainViewButton(driver: Driver, providerId: string): Promise<void> {
  await driver.executeScript((identifier: string) => {
    const container = document.querySelector(`[data-provider="${identifier}"] [data-view]`);
    const button = container?.shadowRoot?.querySelector('button');
    if (button === null || button === undefined) throw new Error('View button is unavailable');
    Reflect.set(window, '__devkitRetainedViewButton', button);
  }, providerId);
}

export async function clickRetainedViewButton(driver: Driver): Promise<void> {
  await driver.executeScript(() => {
    const button: unknown = Reflect.get(window, '__devkitRetainedViewButton');
    Reflect.deleteProperty(window, '__devkitRetainedViewButton');
    if (!(button instanceof HTMLButtonElement)) throw new Error('Retained button is unavailable');
    if (button.isConnected) throw new Error('Retained button is still mounted');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** Keep the actual DOM node in the page because WebDriver rejects detached element references. */
export async function retainDomainButton(driver: Driver): Promise<void> {
  await driver.executeScript(() => {
    const root = document.querySelector('#renderer')?.shadowRoot;
    const button = Array.from(root?.querySelectorAll('button') ?? []).find(
      (element) => element.textContent.trim() === 'Increase matching domain',
    );
    if (!(button instanceof HTMLButtonElement) || !button.isConnected || button.disabled)
      throw new Error('Active domain button is unavailable');
    if (root?.querySelector('input')?.value !== 'shared.example.test')
      throw new Error('Domain input must match both live providers');
    Reflect.set(window, '__devkitRetainedDomainButton', button);
  });
}

export async function clickRetainedDomainButton(driver: Driver): Promise<void> {
  await driver.wait(
    () =>
      driver.executeScript<boolean>(
        () => !document.querySelector('#renderer')?.shadowRoot?.querySelector('button'),
      ),
    10_000,
  );
  await driver.executeScript(() => {
    const button: unknown = Reflect.get(window, '__devkitRetainedDomainButton');
    Reflect.deleteProperty(window, '__devkitRetainedDomainButton');
    if (!(button instanceof HTMLButtonElement)) throw new Error('Domain button is unavailable');
    if (button.isConnected) throw new Error('Domain button is still mounted');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
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
