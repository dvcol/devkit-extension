import assert from 'node:assert/strict';
import { inspectorStateSchema } from '@devkit/example-contribution/inspector';
import { By, until } from 'selenium-webdriver';
import { Driver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';
import type { InspectorHost } from './inspector-hosts.ts';

export function createDriver(extensionUuid: string) {
  const options = new Options()
    .addArguments('-headless')
    .setPreference(
      'extensions.webextensions.uuids',
      JSON.stringify({ 'devkit-native-port@example.invalid': extensionUuid }),
    );
  if (process.env.FIREFOX_BINARY !== undefined) options.setBinary(process.env.FIREFOX_BINARY);
  return Driver.createSession(
    options,
    new ServiceBuilder().addArguments('--allow-system-access').build(),
  );
}

export async function connect(driver: Driver, host: InspectorHost): Promise<void> {
  for (const [id, value] of [
    ['server-url', `${host.origin}/__devkit-remote/`],
    ['server-id', host.provider.provider.id],
    ['server-token', host.token],
  ] as const) {
    const input = driver.findElement(By.id(id));
    await input.clear();
    await input.sendKeys(value);
  }
  await driver.findElement(By.css('#server-form button')).click();
  await result(driver, '#server-result', `"Connected ${host.provider.provider.id}"`);
  assert.equal(await driver.findElement(By.id('server-token')).getAttribute('value'), '');
  await viewText(driver, serverView(host), 'Response body: No response inspected');
  const view = await driver.findElement(By.css(serverView(host))).getShadowRoot();
  assert.equal((await view.findElements(By.css('button'))).length, 5);
}

export function serverView(host: InspectorHost) {
  return `[data-provider="${host.provider.provider.id}"] [data-view]`;
}

export async function result(driver: Driver, selector: string, text: string): Promise<void> {
  await driver.wait(until.elementTextIs(driver.findElement(By.css(selector)), text), 10_000);
}

export async function viewText(driver: Driver, selector: string, text: string): Promise<void> {
  await driver.wait(
    () =>
      driver.executeScript<boolean>(
        (container: string, expected: string) =>
          document.querySelector(container)?.shadowRoot?.textContent?.includes(expected) === true,
        selector,
        text,
      ),
    10_000,
    `Expected ${selector} to contain ${text}`,
  );
}

export async function dispatch(
  driver: Driver,
  selection: string,
  label: string,
  providers: string[],
) {
  await driver.findElement(By.css(`#json-selection option[value="${selection}"]`)).click();
  const root = await driver.findElement(By.id('inspector')).getShadowRoot();
  const buttons = await root.findElements(By.css('button'));
  const labels = await Promise.all(buttons.map((button) => button.getText()));
  const button = buttons[labels.indexOf(label)];
  assert.ok(button);
  await driver.wait(() => button.isEnabled(), 10_000);
  await button.click();
  await driver.wait(
    until.elementTextContains(driver.findElement(By.id('json-result')), '"status":'),
    10_000,
  );
  const outcomes: unknown = JSON.parse(await driver.findElement(By.id('json-result')).getText());
  assert.ok(Array.isArray(outcomes));
  assert.equal(outcomes.length, providers.length);
  for (const provider of providers) outcome(outcomes, provider);
  return outcomes as readonly unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function outcome(outcomes: readonly unknown[], provider: string) {
  const found = outcomes.find(
    (value) => isRecord(value) && isRecord(value.provider) && value.provider.id === provider,
  );
  assert.ok(isRecord(found), `Missing outcome for ${provider}`);
  return found;
}

export function fulfilled(outcomes: readonly unknown[], provider: string) {
  const selected = outcome(outcomes, provider);
  assert.equal(selected.status, 'fulfilled');
  return inspectorStateSchema.parse(selected.value);
}

export function checkResponse(
  outcomes: readonly unknown[],
  provider: string,
  origin: string,
  body: string,
) {
  assert.deepEqual(fulfilled(outcomes, provider).latest, {
    url: `${origin}/inspector-response`,
    status: 200,
    body,
  });
}
