import assert from 'node:assert/strict';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { Context } from 'selenium-webdriver/firefox.js';
import type { Driver } from 'selenium-webdriver/firefox.js';

type PopupSnapshot = {
  timeOrigin: number;
  provider: string;
  caller: string;
  counter: string;
  buttonLabels: readonly string[];
};

/** Observe the actual toolbar popup through native module and HTML updates. */
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
    assert.deepEqual(updated.buttonLabels, ['Increase counter', 'Increase matching domain']);
    await increase(driver, 5);
    assert.equal(
      await popupScript(
        driver,
        "return document.querySelector('#renderer').shadowRoot.querySelector('button').matches(':hover')",
      ),
      true,
    );
    await checkHtmlReload(driver, fixture);
    await increase(driver, 6);
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
    { provider, status: 'Connected', counter: '6' },
  );
}

async function checkHtmlReload(driver: Driver, fixture: string): Promise<void> {
  const previous = await snapshot(driver);
  const marker = crypto.randomUUID();
  const htmlPath = `${fixture}/entrypoints/panel.html`;
  await writeFile(
    htmlPath,
    (await readFile(htmlPath, 'utf8')).replace(
      '</body>',
      `<span hidden data-popup-reload="${marker}"></span></body>`,
    ),
  );
  await driver.wait(
    () =>
      popupScript<boolean>(
        driver,
        `return !!document?.querySelector('[data-popup-reload="${marker}"]')
          && document.querySelector('#status')?.textContent === 'Connected'`,
      ),
    30_000,
  );
  const reloaded = await snapshot(driver);
  assert.notEqual(reloaded.timeOrigin, previous.timeOrigin);
  assert.notEqual(reloaded.caller, previous.caller);
  assert.equal(reloaded.provider, previous.provider);
  assert.equal(reloaded.counter, previous.counter);
  assert.deepEqual(reloaded.buttonLabels, ['Increase counter', 'Increase matching domain']);
  assert.equal(await popupCount(driver), 1);
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
      buttonLabels: Array.from(renderer.querySelectorAll('button'), (button) => button.textContent.trim()),
    };`,
  );
}

async function increase(driver: Driver, counter: number): Promise<void> {
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
          page?.querySelector('#renderer')?.shadowRoot?.textContent.match(/Counter:\\s*(\\d+)/)?.[1] === arguments[0]);`,
        String(counter),
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
