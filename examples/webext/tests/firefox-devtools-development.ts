import assert from 'node:assert/strict';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { Context } from 'selenium-webdriver/firefox.js';
import type { Driver } from 'selenium-webdriver/firefox.js';
import { closePanel, identity, increase, openPanel, panelScript } from './firefox-devtools.ts';
import {
  updateDevtoolsRegistration,
  updateDevtoolsRegistrationHtml,
} from './devtools-registration.ts';

type PanelSnapshot = {
  timeOrigin: number;
  provider: string;
  caller: string;
  counter: string;
  buttonLabels: readonly string[];
};

type Windows = { driver: Driver; options: string; inspected: string };
type PeerSnapshot = {
  url: string;
  timeOrigin: number;
  readyState: string;
  status: string | null;
  provider: string | null;
  counter: string | null;
};
const peerObservations: Array<{
  expected: { counter: number; provider: string };
  snapshot: PeerSnapshot | null;
}> = [];
const counterScript =
  "return document.querySelector('#renderer')?.shadowRoot?.textContent.match(/Counter:\\s*(\\d+)/)?.[1]";

/** Keep the native DevTools tab open throughout the real WXT module and HTML updates. */
export async function checkFirefoxDevtoolsDevelopment(
  driver: Driver,
  fixture: string,
): Promise<void> {
  const options = await driver.getWindowHandle();
  const provider = await driver.executeScript<string>(
    "return document.querySelector('#provider').textContent",
  );
  const counter = Number(await driver.executeScript<string>(counterScript));
  assert.ok(Number.isInteger(counter));
  await driver.switchTo().newWindow('tab');
  const inspected = await driver.getWindowHandle();
  const windows = { driver, options, inspected };
  try {
    await driver.get('data:text/html,<h1>Development inspected page</h1>');
    await driver.setContext(Context.CHROME);
    await openPanel(driver);
    const previous = await snapshot(driver);
    assert.equal(previous.provider, provider);
    assert.equal(previous.counter, String(counter));
    await updateModule(driver, fixture);
    const updated = await snapshot(driver);
    assert.deepEqual({ ...updated, caller: previous.caller }, previous);
    assert.notEqual(updated.caller, previous.caller);
    await increase(driver, counter + 1);
    await peerCounter(windows, counter + 1, provider);
    await checkHtmlReload(driver, fixture, updated, counter + 1);
    await increase(driver, counter + 2);
    await peerCounter(windows, counter + 2, provider);
    await checkRegistrationUpdate(windows, fixture, 'module');
    await checkRegistrationUpdate(windows, fixture, 'html');
    await closePanel(driver);
  } finally {
    await driver.setContext(Context.CONTENT);
    await driver.switchTo().window(inspected);
    await driver.close();
    await driver.switchTo().window(options);
  }
}

async function checkRegistrationUpdate(
  windows: Windows,
  fixture: string,
  change: 'module' | 'html',
): Promise<void> {
  const { driver } = windows;
  const before = await snapshot(driver);
  if (change === 'module') await updateDevtoolsRegistration(fixture);
  else await updateDevtoolsRegistrationHtml(fixture);
  await driver.wait(async () => (await registrationTitles(driver)).length === 0, 30_000);
  if (change === 'html') {
    const output = await readFile(`${fixture}/.output/firefox-mv3-dev/devtools.html`, 'utf8');
    assert.match(output, /data-registration-html="updated"/u);
  }
  const immediateTitles = await registrationTitles(driver);
  assert.deepEqual(immediateTitles, []);
  await closePanel(driver);
  await openPanel(driver);
  assert.deepEqual(await registrationTitles(driver), ['Devkit updated']);
  const after = await snapshot(driver);
  assert.notEqual(after.timeOrigin, before.timeOrigin);
  assert.notEqual(after.caller, before.caller);
  assert.equal(after.provider, before.provider);
  assert.equal(after.counter, before.counter);
  const counter = Number(before.counter) + 1;
  await increase(driver, counter);
  await peerCounter(windows, counter, before.provider);
  const receipt = {
    immediateTitles,
    reopenedTitles: await registrationTitles(driver),
    before,
    after,
  };
  const filename =
    change === 'module' ? 'devtools-registration.json' : 'devtools-registration-html.json';
  await writeFile(`artifacts/firefox-development/${filename}`, JSON.stringify(receipt, null, 2));
}

function registrationTitles(driver: Driver): Promise<string[]> {
  return driver.executeScript(`const toolbox = document.querySelector('.devtools-toolbox-iframe')?.contentDocument;
    return Array.from(toolbox?.querySelectorAll('[data-extension-id="devkit-native-port@example.invalid"]') ?? [], tab => tab.textContent.trim());`);
}

async function updateModule(driver: Driver, fixture: string): Promise<void> {
  const marker = crypto.randomUUID();
  await appendFile(
    `${fixture}/src/panel.ts`,
    `\ndocument.body.dataset.devtoolsDevelopmentUpdate = ${JSON.stringify(marker)};\n`,
  );
  await driver.wait(
    () =>
      panelScript<boolean>(
        driver,
        `return document.body.dataset.devtoolsDevelopmentUpdate === ${JSON.stringify(marker)}`,
      ),
    30_000,
  );
}

async function checkHtmlReload(
  driver: Driver,
  fixture: string,
  previous: PanelSnapshot,
  counter: number,
): Promise<void> {
  const marker = crypto.randomUUID();
  const htmlPath = `${fixture}/entrypoints/panel.html`;
  await writeFile(
    htmlPath,
    (await readFile(htmlPath, 'utf8')).replace(
      '</body>',
      `<span hidden data-devtools-reload="${marker}"></span></body>`,
    ),
  );
  await driver.wait(
    () =>
      panelScript<boolean>(
        driver,
        `return !!document.querySelector('[data-devtools-reload="${marker}"]')
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
  assert.equal(
    await driver.executeScript(
      `return document.querySelector('.devtools-toolbox-iframe').contentDocument
        .querySelector('[data-extension-id="devkit-native-port@example.invalid"]')?.getAttribute('aria-pressed')`,
    ),
    'true',
  );
}

async function snapshot(driver: Driver): Promise<PanelSnapshot> {
  const caller = await identity(driver);
  const state = await panelScript<Omit<PanelSnapshot, 'caller'>>(
    driver,
    `const renderer = document.querySelector('#renderer').shadowRoot;
    return {
      timeOrigin: performance.timeOrigin,
      provider: document.querySelector('#provider').textContent,
      counter: renderer.textContent.match(/Counter:\\s*(\\d+)/)?.[1],
      buttonLabels: Array.from(renderer.querySelectorAll('button'), (button) => button.textContent.trim()),
    };`,
  );
  assert.deepEqual(state.buttonLabels, ['Increase counter', 'Increase matching domain']);
  return { ...state, caller };
}

async function peerCounter(
  { driver, options, inspected }: Windows,
  counter: number,
  provider: string,
): Promise<void> {
  await driver.setContext(Context.CONTENT);
  await driver.switchTo().window(options);
  try {
    await driver.wait(async () => {
      const observed = await peerSnapshot(driver);
      peerObservations.push({ expected: { counter, provider }, snapshot: observed });
      return (
        observed?.status === 'Connected' &&
        observed.counter === String(counter) &&
        observed.provider === provider
      );
    }, 30_000);
  } finally {
    await writeFile(
      'artifacts/firefox-development/devtools-peer.json',
      JSON.stringify(peerObservations, null, 2),
    );
  }
  await driver.switchTo().window(inspected);
  await driver.setContext(Context.CHROME);
}

/** Native HMR can navigate between driver commands; a discarded executeScript returns null. */
function peerSnapshot(driver: Driver): Promise<PeerSnapshot | null> {
  return driver.executeScript(`return {
    url: location.href,
    timeOrigin: performance.timeOrigin,
    readyState: document.readyState,
    status: document.querySelector('#status')?.textContent ?? null,
    provider: document.querySelector('#provider')?.textContent ?? null,
    counter: document.querySelector('#renderer')?.shadowRoot?.textContent.match(/Counter:\\s*(\\d+)/)?.[1] ?? null,
  };`);
}
