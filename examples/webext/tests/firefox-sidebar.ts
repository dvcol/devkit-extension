import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { Key } from 'selenium-webdriver';
import type { WebElement } from 'selenium-webdriver';
import { Context } from 'selenium-webdriver/firefox.js';
import type { Driver } from 'selenium-webdriver/firefox.js';

const counterScript =
  "return document.querySelector('#renderer')?.shadowRoot?.querySelector('.devframes-json-render-scroll-root')?.textContent.match(/Counter:\\s*(\\d+)/)?.[1]";

export async function checkFirefoxSidebar(driver: Driver): Promise<string[]> {
  const provider = await driver.executeScript<string>(
    "return document.querySelector('#provider').textContent",
  );
  assert.equal(await sidebarCount(driver), 0);
  try {
    await openSidebar(driver);
    assert.equal(await sidebarScript(driver, counterScript), '21');
    assert.equal(
      await sidebarScript(driver, "return document.querySelector('#provider').textContent"),
      provider,
    );
    const caller = await identity(driver);
    const timeOrigin = await sidebarScript(driver, 'return sidebar.performance.timeOrigin');
    await increase(driver, 22);
    await peerCounter(driver, 22);
    await checkTabSwitch(driver, caller, timeOrigin);
    await command(driver, '#routed', '23');
    await driver.wait(async () => (await sidebarScript(driver, counterScript)) === '23', 10_000);
    await sidebarScript(driver, "document.querySelector('#wait').click(); return true;");
    await command(driver, '#executions', '{"started":4,"completed":3}');
    await closeSidebar(driver);
    await command(driver, '#release');
    await command(driver, '#executions', '{"started":4,"completed":4}');
    await openSidebar(driver);
    await checkReplacement(driver, provider, caller, timeOrigin);
    await driver.setContext(Context.CHROME);
    await writeFile(
      'artifacts/firefox/native-sidebar.png',
      await driver.takeScreenshot(),
      'base64',
    );
    await driver.setContext(Context.CONTENT);
  } finally {
    await driver.setContext(Context.CONTENT);
    if ((await sidebarCount(driver)) > 0) await closeSidebar(driver);
  }
  return [
    'native sidebar user gestures mount the renderer without horizontal overflow and share state',
    'switching tabs retains the sidebar document, caller and live subscription',
    'closing sidebar removes its document and pending action completes without replay',
    'reopened sidebar has a new caller, retained provider and working JSON action',
  ];
}

async function checkReplacement(
  driver: Driver,
  provider: string,
  caller: string,
  timeOrigin: unknown,
): Promise<void> {
  assert.notEqual(await identity(driver), caller);
  assert.notEqual(await sidebarScript(driver, 'return sidebar.performance.timeOrigin'), timeOrigin);
  assert.equal(
    await sidebarScript(driver, "return document.querySelector('#provider').textContent"),
    provider,
  );
  assert.equal(await sidebarScript(driver, counterScript), '23');
  await increase(driver, 24);
  await peerCounter(driver, 24);
  await command(driver, '#executions', '{"started":4,"completed":4}');
  assert.equal(
    await sidebarScript(
      driver,
      'return document.documentElement.scrollWidth <= sidebar.innerWidth',
    ),
    true,
  );
}

async function checkTabSwitch(driver: Driver, caller: string, timeOrigin: unknown): Promise<void> {
  const options = await driver.getWindowHandle();
  await driver.switchTo().newWindow('tab');
  const unrelated = await driver.getWindowHandle();
  try {
    await driver.get('data:text/html,<h1>Unrelated page</h1>');
    await driver.setContext(Context.CHROME);
    assert.equal(
      await driver.executeScript(
        "return document.querySelector('#sidebar-box').getAttribute('sidebarcommand')",
      ),
      'devkit-native-port_example_invalid-sidebar-action',
    );
    await driver.switchTo().window(options);
    await driver.setContext(Context.CONTENT);
    assert.equal(await sidebarScript(driver, 'return sidebar.performance.timeOrigin'), timeOrigin);
    assert.equal(await identity(driver), caller);
  } finally {
    await driver.setContext(Context.CONTENT);
    await driver.switchTo().window(unrelated);
    await driver.close();
    await driver.switchTo().window(options);
  }
}

export async function openSidebar(driver: Driver): Promise<void> {
  await driver.setContext(Context.CHROME);
  const modifier = process.platform === 'darwin' ? Key.COMMAND : Key.CONTROL;
  await driver.actions().keyDown(modifier).sendKeys('b').keyUp(modifier).perform();
  await toggleSidebar(driver);
  await driver.setContext(Context.CONTENT);
  await driver.wait(
    async () =>
      (await sidebarScript(driver, "return document?.querySelector('#status')?.textContent")) ===
      'Connected',
    10_000,
  );
  await driver.wait(
    () =>
      sidebarScript(
        driver,
        "return !!document?.querySelector('#renderer')?.shadowRoot?.querySelector('button')",
      ),
    10_000,
  );
}

export async function closeSidebar(driver: Driver): Promise<void> {
  await driver.setContext(Context.CHROME);
  await toggleSidebar(driver);
  await driver.setContext(Context.CONTENT);
  await driver.wait(async () => (await sidebarCount(driver)) === 0, 10_000);
}

/** Chrome context requires script lookup for shadow elements; WebDriver performs the native click. */
async function toggleSidebar(driver: Driver): Promise<void> {
  const button = await driver.executeScript<WebElement>(
    `return document.querySelector('sidebar-main').shadowRoot.querySelector('[extensionId="devkit-native-port@example.invalid"]');`,
  );
  await button.click();
}

function sidebarCount(driver: Driver): Promise<number> {
  return driver.executeScript("return browser.extension.getViews({ type: 'sidebar' }).length");
}

/** The public extension API exposes the actual sidebar document to its options-page peer. */
export function sidebarScript<Value = unknown>(driver: Driver, script: string): Promise<Value> {
  return driver.executeScript<Value>(
    `const sidebar = browser.extension.getViews({ type: 'sidebar' })[0];
    const document = sidebar?.document; ${script}`,
  );
}

export async function identity(driver: Driver): Promise<string> {
  await sidebarScript(driver, "document.querySelector('#identity').click(); return true;");
  await driver.wait(
    async () =>
      String(
        await sidebarScript(driver, "return document.querySelector('#result').textContent"),
      ).includes('panel.html'),
    10_000,
  );
  const caller = await sidebarScript(
    driver,
    "return document.querySelector('#result').textContent",
  );
  assert.ok(typeof caller === 'string');
  return caller;
}

export async function increase(driver: Driver, value: number): Promise<void> {
  const center = await sidebarScript<{ x: number; y: number }>(
    driver,
    `const button = document.querySelector('#renderer').shadowRoot.querySelector('button');
    button.scrollIntoView({ block: 'nearest' });
    const bounds = button.getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };`,
  );
  await driver.setContext(Context.CHROME);
  const offset = await driver.executeScript<{ x: number; y: number }>(
    `const sidebar = document.querySelector('#sidebar');
    const outer = sidebar.getBoundingClientRect();
    const inner = sidebar.contentDocument.querySelector('#webext-panels-browser').getBoundingClientRect();
    return { x: outer.x + inner.x, y: outer.y + inner.y };`,
  );
  await driver
    .actions()
    .move({ x: Math.round(center.x + offset.x), y: Math.round(center.y + offset.y) })
    .click()
    .perform();
  await driver.setContext(Context.CONTENT);
  await driver.wait(
    async () => (await sidebarScript(driver, counterScript)) === String(value),
    10_000,
  );
  await driver.wait(
    () =>
      sidebarScript(
        driver,
        "return document.querySelector('#renderer').shadowRoot.querySelector('button').getAnimations().length === 0",
      ),
    10_000,
  );
}

async function peerCounter(driver: Driver, value: number): Promise<void> {
  await driver.wait(
    async () => (await driver.executeScript(counterScript)) === String(value),
    10_000,
  );
}

async function command(driver: Driver, selector: string, expected?: string): Promise<void> {
  await driver.executeScript('document.querySelector(arguments[0]).click()', selector);
  await driver.wait(async () => {
    const result = await driver.executeScript<string>(
      "return document.querySelector('#result').textContent",
    );
    if (expected !== undefined) return result === expected;
    return result !== 'Pending';
  }, 10_000);
}
