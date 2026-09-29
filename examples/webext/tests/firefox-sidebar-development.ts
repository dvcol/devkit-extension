import assert from 'node:assert/strict';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { Context } from 'selenium-webdriver/firefox.js';
import type { Driver } from 'selenium-webdriver/firefox.js';
import { closeSidebar, identity, increase, openSidebar, sidebarScript } from './firefox-sidebar.ts';

type SidebarSnapshot = {
  timeOrigin: number;
  provider: string;
  caller: string;
  counter: string;
  buttonLabels: readonly string[];
};

const counterScript =
  "return document.querySelector('#renderer')?.shadowRoot?.textContent.match(/Counter:\\s*(\\d+)/)?.[1]";

/** Observe the same native sidebar through WXT updates without closing or reopening it. */
export async function checkFirefoxSidebarDevelopment(
  driver: Driver,
  fixture: string,
): Promise<void> {
  const provider = await driver.executeScript<string>(
    "return document.querySelector('#provider').textContent",
  );
  const counter = Number(await driver.executeScript<string>(counterScript));
  assert.ok(Number.isInteger(counter));
  assert.equal(await sidebarCount(driver), 0);
  try {
    await openSidebar(driver);
    const previous = await snapshot(driver);
    assert.equal(previous.provider, provider);
    assert.equal(previous.counter, String(counter));
    await updateModule(driver, fixture);
    const updated = await snapshot(driver);
    assert.deepEqual({ ...updated, caller: previous.caller }, previous);
    assert.notEqual(updated.caller, previous.caller);
    await increase(driver, counter + 1);
    await peerCounter(driver, counter + 1, provider);
    await checkHtmlReload(driver, fixture, updated, counter + 1);
    await increase(driver, counter + 2);
    await peerCounter(driver, counter + 2, provider);
  } finally {
    await driver.setContext(Context.CONTENT);
    if ((await sidebarCount(driver)) > 0) await closeSidebar(driver);
  }
  assert.equal(await sidebarCount(driver), 0);
}

async function updateModule(driver: Driver, fixture: string): Promise<void> {
  const marker = crypto.randomUUID();
  await appendFile(
    `${fixture}/src/panel.ts`,
    `\ndocument.body.dataset.sidebarDevelopmentUpdate = ${JSON.stringify(marker)};\n`,
  );
  await driver.wait(
    () =>
      sidebarScript<boolean>(
        driver,
        `return document.body.dataset.sidebarDevelopmentUpdate === ${JSON.stringify(marker)}`,
      ),
    30_000,
  );
  assert.equal(await sidebarCount(driver), 1);
}

async function checkHtmlReload(
  driver: Driver,
  fixture: string,
  previous: SidebarSnapshot,
  counter: number,
): Promise<void> {
  const marker = crypto.randomUUID();
  const htmlPath = `${fixture}/entrypoints/panel.html`;
  await writeFile(
    htmlPath,
    (await readFile(htmlPath, 'utf8')).replace(
      '</body>',
      `<span hidden data-sidebar-reload="${marker}"></span></body>`,
    ),
  );
  await driver.wait(
    () =>
      sidebarScript<boolean>(
        driver,
        `return !!document?.querySelector('[data-sidebar-reload="${marker}"]')
          && document.querySelector('#status')?.textContent === 'Connected'`,
      ),
    30_000,
  );
  const reloaded = await snapshot(driver);
  assert.notEqual(reloaded.timeOrigin, previous.timeOrigin);
  assert.notEqual(reloaded.caller, previous.caller);
  assert.equal(reloaded.provider, previous.provider);
  assert.equal(reloaded.counter, String(counter));
  assert.deepEqual(reloaded.buttonLabels, ['Increase counter', 'Increase matching domain']);
  assert.equal(await sidebarCount(driver), 1);
}

async function snapshot(driver: Driver): Promise<SidebarSnapshot> {
  const caller = await identity(driver);
  const state = await sidebarScript<Omit<SidebarSnapshot, 'caller'>>(
    driver,
    `const renderer = document.querySelector('#renderer').shadowRoot;
    return {
      timeOrigin: sidebar.performance.timeOrigin,
      provider: document.querySelector('#provider').textContent,
      counter: renderer.textContent.match(/Counter:\\s*(\\d+)/)?.[1],
      buttonLabels: Array.from(renderer.querySelectorAll('button'), (button) => button.textContent.trim()),
    };`,
  );
  assert.deepEqual(state.buttonLabels, ['Increase counter', 'Increase matching domain']);
  return { ...state, caller };
}

async function peerCounter(driver: Driver, counter: number, provider: string): Promise<void> {
  await driver.wait(
    async () => (await driver.executeScript(counterScript)) === String(counter),
    30_000,
  );
  assert.equal(
    await driver.executeScript("return document.querySelector('#provider').textContent"),
    provider,
  );
}

function sidebarCount(driver: Driver): Promise<number> {
  return driver.executeScript("return browser.extension.getViews({ type: 'sidebar' }).length");
}
