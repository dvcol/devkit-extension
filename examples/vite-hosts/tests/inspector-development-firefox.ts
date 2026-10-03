import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { styleText } from 'node:util';
import { getTempAuthCodeInfo } from 'devframe/node/auth';
import { By, until } from 'selenium-webdriver';
import { Driver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';
import { click, connectInspector, snapshot, waitText } from './inspector-firefox-actions.ts';
import type { InspectorPage } from './inspector-firefox-actions.ts';
import {
  inspectorDevelopmentChecks,
  inspectorDevelopmentFixture,
} from './inspector-development-fixture.ts';

await using cleanup = new AsyncDisposableStack();
const options = new Options().addArguments('-headless');
options.set('unhandledPromptBehavior', 'ignore');
if (process.env.FIREFOX_BINARY !== undefined) options.setBinary(process.env.FIREFOX_BINARY);
const driver = Driver.createSession(options, new ServiceBuilder().build());
cleanup.defer(() => driver.quit());
const capabilities = await driver.getCapabilities();
const observations = [];
for (const host of ['devframe', 'devtools'] as const)
  observations.push(await checkHost(driver, host));
const receipt = {
  browser: capabilities.getBrowserVersion(),
  driver: capabilities.get('moz:geckodriverVersion') as unknown,
  observations,
  checks: observations.flatMap(({ host }) =>
    inspectorDevelopmentChecks.map((check) => `${host}: ${check}`),
  ),
  limitations: [
    'WebDriver Classic does not capture global page or console errors; actual native overlay and visible renderer state are asserted',
    'Native inspector main-module reload only; backend module HMR and extension edits are not exercised',
    'A failed browser module cannot dispatch actions; the native backend remains alive with its prior state',
  ],
};
await cleanup.disposeAsync();
await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/inspector-development-firefox.json',
  `${JSON.stringify(receipt, null, 2)}\n`,
);
console.info(styleText('green', '🧪 [inspector/development/firefox]'), receipt);

async function checkHost(browser: Driver, host: 'devframe' | 'devtools') {
  await using lifetime = new AsyncDisposableStack();
  const fixture = await inspectorDevelopmentFixture(host);
  lifetime.defer(fixture.close);
  lifetime.defer(() => browser.get('about:blank'));
  const page = { driver: browser, window: await browser.getWindowHandle(), ...fixture };
  await connectInspector(page);
  await click(page, 'Enable response modification', 'Configuration dispatch complete');
  await inspect(page, fixture, 1);
  const initial = await state(page);
  await fixture.edit('Updated development inspector');
  const firstAuth = await authenticateReload(browser);
  const updated = await reloaded(page, initial.document, 'Updated development inspector');
  assert.deepEqual(updated.provider, initial.provider);
  assert.equal(fixture.requests.length, 1);
  await inspect(page, fixture, 2);
  const failure = await failSource(browser, fixture, updated.document);
  assert.equal(fixture.requests.length, 2);
  await fixture.edit('Recovered development inspector');
  const secondAuth = await authenticateReload(browser);
  const recovered = await reloaded(page, failure.document, 'Recovered development inspector');
  assert.deepEqual(recovered.provider, initial.provider);
  assert.equal(fixture.requests.length, 2);
  await inspect(page, fixture, 3);
  return {
    host,
    initial,
    updated,
    failure,
    recovered,
    requests: fixture.requests,
    authPrompts: [firstAuth, secondAuth],
  };
}

async function inspect(
  page: InspectorPage,
  fixture: Awaited<ReturnType<typeof inspectorDevelopmentFixture>>,
  expectedRequests: number,
): Promise<void> {
  await click(page, 'Inspect response', 'Inspection dispatch complete');
  await waitText(page, 'Response body: native:fixture:original');
  await page.driver.wait(
    () =>
      fixture.requests.length === expectedRequests &&
      fixture.requests.every((request) => request.completed),
    10_000,
  );
}

async function state(page: InspectorPage) {
  const current = await snapshot(page);
  assert.equal(current.connection, 'Connected');
  assert.equal(current.buttons, 5);
  assert.equal(current.body, 'Response body: native:fixture:original');
  assert.equal(current.configuration, 'Modification enabled: true');
  assert.equal((await page.driver.findElements(By.css('#inspector > div'))).length, 1);
  return {
    document: await page.driver.executeScript<number>(() => performance.timeOrigin),
    provider: current.provider,
    renderer: await page.driver.findElement(By.id('inspector-renderer')).getAttribute('value'),
    body: current.body,
    configuration: current.configuration,
  };
}

async function authenticateReload(browser: Driver): Promise<string> {
  const prompt = await browser.wait(until.alertIsPresent(), 10_000);
  const message = await prompt.getText();
  assert.equal(message, 'devframe: enter the authentication code shown in your terminal');
  await prompt.sendKeys(getTempAuthCodeInfo().code);
  await prompt.accept();
  return message;
}

async function reloaded(page: InspectorPage, previous: number, heading: string) {
  await page.driver.wait(
    async () => (await page.driver.findElement(By.css('h1')).getText()) === heading,
    10_000,
  );
  await waitText(page, 'Response body: native:fixture:original');
  const current = await state(page);
  assert.notEqual(current.document, previous);
  return current;
}

async function failSource(
  browser: Driver,
  fixture: Awaited<ReturnType<typeof inspectorDevelopmentFixture>>,
  previous: number,
) {
  await fixture.invalidate();
  await browser.wait(until.elementLocated(By.css('vite-error-overlay')), 10_000);
  const failure = await browser.executeScript<{
    document: number;
    message: string;
    mounts: number;
    rendererDisabled: boolean;
  }>(() => ({
    document: performance.timeOrigin,
    message:
      document.querySelector('vite-error-overlay')?.shadowRoot?.querySelector('.message-body')
        ?.textContent ?? '',
    mounts: document.querySelectorAll('#inspector > div').length,
    rendererDisabled: document.querySelector('#inspector-renderer')?.matches(':disabled') === true,
  }));
  assert.notEqual(failure.document, previous);
  assert.match(failure.message, /\[PARSE_ERROR\] Unexpected token/u);
  assert.match(failure.message, /export const invalidInspector = ;/u);
  assert.equal(failure.mounts, 0);
  assert.equal(failure.rendererDisabled, true);
  return failure;
}
