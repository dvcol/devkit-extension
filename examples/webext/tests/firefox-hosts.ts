import assert from 'node:assert/strict';
import { styleText } from 'node:util';
import type { Driver } from 'selenium-webdriver/firefox.js';
import { By, until } from 'selenium-webdriver';
import { nativeSurfaceScript } from './native-surfaces.ts';
import { checkFirefoxDevtools } from './firefox-devtools.ts';
import { checkFirefoxSidebar } from './firefox-sidebar.ts';

/** Exercise native hosts in sequence against the surviving options page and background provider. */
export async function checkFirefoxHosts(driver: Driver): Promise<string[]> {
  console.info(styleText('cyan', '🧪 [webext/firefox/hosts]'), 'Opening native popup and options');
  await driver.manage().setTimeouts({ script: 60_000 });
  const result = await driver.executeAsyncScript<{ checks?: string[]; error?: string }>(
    `const done = arguments[arguments.length - 1]; ${nativeSurfaceScript}
checkNativeSurfaces().then(checks => done({ checks }), error => done({ error: error.stack ?? String(error) }));`,
  );
  assert.equal(result.error, undefined);
  assert.ok(result.checks !== undefined);
  console.info(styleText('cyan', '🧪 [webext/firefox/hosts]'), 'Opening native DevTools');
  const devtools = await checkFirefoxDevtools(driver);
  console.info(styleText('cyan', '🧪 [webext/firefox/hosts]'), 'Opening native sidebar');
  return [...result.checks, ...devtools, ...(await checkFirefoxSidebar(driver))];
}

export async function retainCounterViewButton(driver: Driver): Promise<void> {
  await driver.executeScript(
    `window.detachedCounterButton = document.querySelector('#renderer').shadowRoot.querySelector('button');`,
  );
}

export async function verifyRemovedCounterView(driver: Driver): Promise<void> {
  await driver.wait(
    () =>
      driver.executeScript<boolean>(
        'return !document.querySelector("#renderer").shadowRoot?.querySelector("button")',
      ),
    10_000,
  );
}

export async function verifyRestoredCounterView(driver: Driver, value: number): Promise<void> {
  await driver.wait(
    () =>
      driver.executeScript<boolean>(
        `return document.querySelector('#renderer').shadowRoot.textContent.includes('Counter: ' + arguments[0]);`,
        value,
      ),
    10_000,
  );
  await driver.executeScript(
    'window.detachedCounterButton.click(); delete window.detachedCounterButton;',
  );
  await driver.findElement(By.id('capability')).click();
  await driver.wait(
    until.elementTextIs(driver.findElement(By.id('result')), String(value)),
    10_000,
  );
}

export async function checkFirefoxDeniedPage(driver: Driver, origin: string): Promise<void> {
  await driver.switchTo().newWindow('tab');
  await driver.get(`${origin}/denied.html`);
  await driver.wait(
    until.elementTextIs(driver.findElement(By.id('status')), 'Disconnected'),
    10_000,
  );
  await driver.wait(
    until.elementTextContains(driver.findElement(By.id('result')), 'closed'),
    10_000,
  );
  assert.equal(
    await driver.executeScript<boolean>(
      'return !!document.querySelector("#renderer").shadowRoot?.querySelector("button")',
    ),
    false,
  );
  await driver.close();
}
