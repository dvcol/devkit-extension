import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { Key } from 'selenium-webdriver';
import { Context } from 'selenium-webdriver/firefox.js';
import type { Driver } from 'selenium-webdriver/firefox.js';

type Windows = { driver: Driver; options: string; inspected: string };
const counterScript =
  "return document.querySelector('#renderer')?.shadowRoot?.querySelector('.devframes-json-render-scroll-root')?.textContent.match(/Counter:\\s*(\\d+)/)?.[1]";

export async function checkFirefoxDevtools(driver: Driver): Promise<string[]> {
  const options = await driver.getWindowHandle();
  const provider = await driver.executeScript<string>(
    "return document.querySelector('#provider').textContent",
  );
  await driver.switchTo().newWindow('tab');
  const inspected = await driver.getWindowHandle();
  const windows = { driver, options, inspected };
  try {
    await driver.get('data:text/html,<h1>Inspected page</h1>');
    await driver.setContext(Context.CHROME);
    await openPanel(driver);
    const caller = await checkLivePanel(windows, provider);
    await closePanel(driver);
    await useOptions(windows);
    await command(driver, '#release');
    await command(driver, '#executions', '{"started":3,"completed":3}');
    await useDevtools(windows);
    await openPanel(driver);
    await checkReplacement(windows, provider, caller);
    await writeFile(
      'artifacts/firefox/native-devtools.png',
      await driver.takeScreenshot(),
      'base64',
    );
    await closePanel(driver);
  } finally {
    await driver.setContext(Context.CONTENT);
    await driver.switchTo().window(inspected);
    await driver.close();
    await driver.switchTo().window(options);
  }
  return [
    'native DevTools panel mounts the existing renderer and shares background state',
    'hiding DevTools panel retains its document, connection and live subscriptions',
    'closing DevTools removes its panel and pending action completes without replay',
    'reopened DevTools panel has a new caller, retained provider and working JSON action',
  ];
}

async function checkLivePanel(windows: Windows, provider: string): Promise<string> {
  const { driver } = windows;
  assert.equal(
    await panelScript(driver, "return document.querySelector('#provider').textContent"),
    provider,
  );
  const caller = await identity(driver);
  const timeOrigin = await panelScript(driver, 'return performance.timeOrigin');
  await increase(driver, 19);
  await useOptions(windows);
  await optionsCounter(driver, 19);
  await useDevtools(windows);
  await selectPanel(driver, false);
  await useOptions(windows);
  await command(driver, '#routed', '20');
  await useDevtools(windows);
  await selectPanel(driver, true);
  assert.equal(await panelScript(driver, 'return performance.timeOrigin'), timeOrigin);
  assert.equal(await identity(driver), caller);
  await driver.wait(async () => (await panelScript(driver, counterScript)) === '20', 10_000);
  await panelScript(driver, "document.querySelector('#wait').click(); return true;");
  await useOptions(windows);
  await command(driver, '#executions', '{"started":3,"completed":2}');
  await useDevtools(windows);
  return caller;
}

async function checkReplacement(windows: Windows, provider: string, caller: string): Promise<void> {
  const { driver } = windows;
  assert.equal(
    await panelScript(driver, "return document.querySelector('#provider').textContent"),
    provider,
  );
  assert.notEqual(await identity(driver), caller);
  assert.equal(await panelScript(driver, counterScript), '20');
  await increase(driver, 21);
  await useOptions(windows);
  await optionsCounter(driver, 21);
  await command(driver, '#executions', '{"started":3,"completed":3}');
  await useDevtools(windows);
}

async function openPanel(driver: Driver): Promise<void> {
  await driver.actions().sendKeys(Key.F12).perform();
  await driver.wait(
    () =>
      driver.executeScript<boolean>(
        `return !!document.querySelector('.devtools-toolbox-iframe')?.contentDocument?.querySelector('[data-extension-id="devkit-native-port@example.invalid"]')`,
      ),
    10_000,
  );
  await selectPanel(driver, true);
  await driver.wait(
    async () =>
      (await panelScript(driver, "return document.querySelector('#status')?.textContent")) ===
      'Connected',
    10_000,
  );
}

async function selectPanel(driver: Driver, extension: boolean): Promise<void> {
  await driver.executeScript(
    `
    const toolbox = document.querySelector('.devtools-toolbox-iframe').contentDocument;
    const selector = arguments[0] ? '[data-extension-id="devkit-native-port@example.invalid"]' : '.devtools-tab:not([data-extension-id])';
    toolbox.querySelector(selector).dispatchEvent(new toolbox.defaultView.MouseEvent('mousedown', { bubbles: true, button: 0 }));
  `,
    extension,
  );
  await driver.wait(
    () =>
      driver.executeScript<boolean>(
        `const toolbox = document.querySelector('.devtools-toolbox-iframe').contentDocument;
        if (toolbox.querySelector('[data-extension-id="devkit-native-port@example.invalid"]').getAttribute('aria-pressed') !== String(arguments[0])) return false;
        if (!arguments[0]) return true;
        const browser = toolbox.querySelector('iframe[src="chrome://browser/content/webext-panels.xhtml"]')?.contentDocument?.querySelector('#webext-panels-browser');
        return browser?.browsingContext?.currentWindowGlobal?.documentURI?.spec.endsWith('/panel.html') === true;`,
        extension,
      ),
    10_000,
  );
}

async function closePanel(driver: Driver): Promise<void> {
  await driver.actions().sendKeys(Key.F12).perform();
  await driver.wait(
    () =>
      driver.executeScript<boolean>("return !document.querySelector('.devtools-toolbox-iframe')"),
    10_000,
  );
}

/** Only tests use this pinned Firefox actor: public WebDriver frame APIs omit the XUL panel browser. */
async function panelScript(driver: Driver, script: string): Promise<unknown> {
  const response = await driver.executeAsyncScript<{ value?: unknown; error?: string }>(
    `
    const done = arguments[arguments.length - 1];
    const toolbox = document.querySelector('.devtools-toolbox-iframe').contentDocument;
    const panel = toolbox.querySelector('iframe[src="chrome://browser/content/webext-panels.xhtml"]').contentDocument;
    const browser = panel.querySelector('#webext-panels-browser');
    browser.browsingContext.currentWindowGlobal.getActor('MarionetteCommands')
      .sendQuery('MarionetteCommandsParent:executeScript', {
        script: arguments[0], args: [],
        opts: { sandboxName: 'default', newSandbox: true, timeout: 10000 },
      }).then(value => done({ value }), error => done({ error: String(error) }));
  `,
    script,
  );
  assert.equal(response.error, undefined);
  return response.value;
}

async function identity(driver: Driver): Promise<string> {
  await panelScript(driver, "document.querySelector('#identity').click(); return true;");
  await driver.wait(
    async () =>
      String(
        await panelScript(driver, "return document.querySelector('#result').textContent"),
      ).includes('panel.html'),
    10_000,
  );
  const caller = await panelScript(driver, "return document.querySelector('#result').textContent");
  assert.ok(typeof caller === 'string');
  return caller;
}

async function increase(driver: Driver, value: number): Promise<void> {
  await panelScript(
    driver,
    "document.querySelector('#renderer').shadowRoot.querySelector('button').click(); return true;",
  );
  await driver.wait(
    async () => (await panelScript(driver, counterScript)) === String(value),
    10_000,
  );
}

async function optionsCounter(driver: Driver, value: number): Promise<void> {
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

async function useOptions({ driver, options }: Windows): Promise<void> {
  await driver.switchTo().window(options);
  await driver.setContext(Context.CONTENT);
}

async function useDevtools({ driver, inspected }: Windows): Promise<void> {
  await driver.switchTo().window(inspected);
  await driver.setContext(Context.CHROME);
}
