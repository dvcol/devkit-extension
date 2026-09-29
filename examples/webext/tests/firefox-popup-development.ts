import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';
import { Context } from 'selenium-webdriver/firefox.js';
import type { Driver } from 'selenium-webdriver/firefox.js';

type PopupSnapshot = {
  timeOrigin: number;
  provider: string;
  caller: string;
  counter: string;
  buttons: number;
};

/** Observe the actual toolbar popup while WXT updates its existing panel module. */
export async function checkFirefoxPopupDevelopment(driver: Driver, fixture: string): Promise<void> {
  const provider = await driver.executeScript<string>(
    "return document.querySelector('#provider').textContent",
  );
  assert.equal(await popupCount(driver), 0);
  try {
    await driver.executeScript('return browser.action.openPopup()');
    await driver.wait(
      async () =>
        (await popupScript(driver, "return document?.querySelector('#status')?.textContent")) ===
        'Connected',
      30_000,
    );
    const previous = await snapshot(driver);
    assert.equal(previous.provider, provider);
    assert.equal(previous.counter, '4');
    await updateModule(driver, fixture);
    const updated = await snapshot(driver);
    assert.equal(updated.timeOrigin, previous.timeOrigin);
    assert.equal(updated.provider, provider);
    assert.notEqual(updated.caller, previous.caller);
    assert.equal(updated.counter, '4');
    assert.equal(updated.buttons, 1);
    await increase(driver);
    assert.equal(
      await popupScript(
        driver,
        "return document.querySelector('#renderer').shadowRoot.querySelector('button').matches(':hover')",
      ),
      true,
    );
  } finally {
    await driver.setContext(Context.CONTENT);
    await driver.executeScript("browser.extension.getViews({ type: 'popup' })[0]?.close()");
    await driver.wait(async () => (await popupCount(driver)) === 0, 10_000);
  }
  assert.deepEqual(
    await driver.executeScript(
      `return {
        provider: document.querySelector('#provider').textContent,
        status: document.querySelector('#status').textContent,
        counter: document.querySelector('#renderer').shadowRoot.textContent.match(/Counter:\\s*(\\d+)/)?.[1],
      };`,
    ),
    { provider, status: 'Connected', counter: '5' },
  );
}

async function updateModule(driver: Driver, fixture: string): Promise<void> {
  const marker = crypto.randomUUID();
  await appendFile(
    `${fixture}/src/panel.ts`,
    `\ndocument.body.dataset.popupDevelopmentUpdate = ${JSON.stringify(marker)};\n`,
  );
  await driver.wait(
    () =>
      driver.executeScript<boolean>(
        `const popup = browser.extension.getViews({ type: 'popup' })[0];
        return document.body.dataset.popupDevelopmentUpdate === arguments[0]
          && popup?.document.body.dataset.popupDevelopmentUpdate === arguments[0];`,
        marker,
      ),
    30_000,
  );
  assert.equal(await popupCount(driver), 1);
}

async function snapshot(driver: Driver): Promise<PopupSnapshot> {
  await popupScript(driver, "document.querySelector('#identity').click(); return true;");
  await driver.wait(
    () =>
      popupScript(
        driver,
        "return document.querySelector('#result').textContent.includes('panel.html')",
      ),
    10_000,
  );
  return popupScript<PopupSnapshot>(
    driver,
    `const renderer = document.querySelector('#renderer').shadowRoot;
    return {
      timeOrigin: popup.performance.timeOrigin,
      provider: document.querySelector('#provider').textContent,
      caller: document.querySelector('#result').textContent,
      counter: renderer.textContent.match(/Counter:\\s*(\\d+)/)?.[1],
      buttons: renderer.querySelectorAll('button').length,
    };`,
  );
}

async function increase(driver: Driver): Promise<void> {
  const center = await popupScript<{ x: number; y: number }>(
    driver,
    `const button = document.querySelector('#renderer').shadowRoot.querySelector('button');
    button.scrollIntoView({ block: 'nearest' });
    const bounds = button.getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };`,
  );
  await driver.setContext(Context.CHROME);
  const offset = await driver.executeScript<{ x: number; y: number }>(
    `const bounds = document.querySelector('browser[webextension-view-type="popup"]').getBoundingClientRect();
    return { x: bounds.x, y: bounds.y };`,
  );
  await driver
    .actions()
    .move({ x: Math.round(center.x + offset.x), y: Math.round(center.y + offset.y) })
    .click()
    .perform();
  await driver.setContext(Context.CONTENT);
  await driver.wait(
    () =>
      driver.executeScript<boolean>(
        `const popup = browser.extension.getViews({ type: 'popup' })[0];
        return [document, popup?.document].every(page =>
          page?.querySelector('#renderer')?.shadowRoot?.textContent.match(/Counter:\\s*(\\d+)/)?.[1] === '5');`,
      ),
    30_000,
  );
}

function popupCount(driver: Driver): Promise<number> {
  return driver.executeScript("return browser.extension.getViews({ type: 'popup' }).length");
}

function popupScript<Value = unknown>(driver: Driver, script: string): Promise<Value> {
  return driver.executeScript<Value>(
    `const popup = browser.extension.getViews({ type: 'popup' })[0];
    const document = popup?.document; ${script}`,
  );
}
