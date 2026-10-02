import assert from 'node:assert/strict';
import { styleText } from 'node:util';
import { By } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';

/** The reference renderer uses a shadow root; a fresh custom mount uses the same host's light DOM. */
export function readView(driver: Driver) {
  return driver.executeScript<{
    text: string;
    alert: string;
    buttons: number;
    customViews: number;
    referenceViews: number;
  }>(() => {
    const container = document.querySelector('#view > div');
    const root = container?.shadowRoot ?? container;
    const content = root?.querySelector<HTMLElement>(
      '.devframes-json-render-scroll-root, [data-renderer="custom"]',
    );
    return {
      text: content?.innerText ?? '',
      alert: root?.querySelector('[role="alert"]')?.textContent ?? '',
      buttons: root?.querySelectorAll('button').length ?? 0,
      customViews: root?.querySelectorAll('[data-renderer="custom"]').length ?? 0,
      referenceViews: root?.querySelectorAll('.devframes-json-render-scroll-root').length ?? 0,
    };
  });
}

export async function viewCounter(driver: Driver, value: number): Promise<void> {
  try {
    await driver.wait(
      async () => {
        const view = await readView(driver);
        return new RegExp(`Counter: ${value}\\b`, 'u').test(view.text) && view.buttons === 2;
      },
      10_000,
      `Expected one native or custom view at Counter: ${value}`,
    );
  } catch (error) {
    console.error(styleText('red', '❌ [json-render/firefox]'), {
      status: await driver.findElement(By.id('status')).getText(),
      view: await readView(driver),
    });
    throw error;
  }
  assert.equal((await driver.findElements(By.css('#view > div'))).length, 1);
}

export async function viewEmpty(driver: Driver): Promise<void> {
  await driver.wait(
    async () => (await driver.findElements(By.css('#view > *'))).length === 0,
    10_000,
  );
}

export async function clickAction(driver: Driver, label: string): Promise<void> {
  const container = await driver.findElement(By.css('#view > div'));
  const shadow = await driver.executeScript<boolean>(
    'return arguments[0].shadowRoot !== null',
    container,
  );
  const root = shadow ? await container.getShadowRoot() : container;
  for (const button of await root.findElements(By.css('button'))) {
    if ((await button.getText()).trim() !== label) continue;
    await button.click();
    return;
  }
  throw new Error(`Missing rendered action: ${label}`);
}
