import assert from 'node:assert/strict';
import { createRemoteHost } from '@devkit/example-server-contexts';
import { counterCapability } from '@devkit/example-contribution';
import { By, until } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';
import {
  checkFirefoxViews,
  clickRetainedViewButton,
  clickView,
  retainViewButton,
  viewText,
} from './firefox-views.ts';

type ServerHost = Awaited<ReturnType<typeof createRemoteHost>>;

export async function checkFirefoxServers(driver: Driver): Promise<void> {
  await using cleanup = new AsyncDisposableStack();
  await checkMissingServers(driver);
  const allowedOrigins = [await driver.executeScript<string>('return location.origin')];
  await checkDeniedOrigin(driver);
  const devframe = await createRemoteHost('devframe', {
    providerId: 'example.devframe',
    allowedOrigins,
  });
  cleanup.defer(devframe.close);
  const devtools = await createRemoteHost('devtools', {
    providerId: 'example.devtools',
    allowedOrigins,
  });
  cleanup.defer(devtools.close);
  await connect(driver, devframe, 'invalid-token');
  /** Firefox can expose native authentication rejection as an opaque WebSocket error. */
  await result(driver, /authoriz|trust|credentials|^error$/iu);
  assert.equal(await readCounter(devframe), 0);
  assert.doesNotMatch(
    await driver.findElement(By.css('#providers')).getText(),
    /example\.devframe/u,
  );
  await connect(driver, devframe, devframe.token);
  await result(driver, /^"Connected example\.devframe"$/u);
  await connect(driver, devtools, devtools.token);
  await result(driver, /^"Connected example\.devtools"$/u);
  await checkBroadcast(driver, devframe, devtools);
  cleanup.defer(await checkFirefoxViews(driver, devframe, devtools));
  await fill(driver, '#preferred-server', 'example.devframe');
  await driver.findElement(By.css('#fallback-increase')).click();
  await result(driver, /^5$/u);
  assert.equal(await readCounter(devframe), 5);
  assert.equal(await readCounter(devtools), 3);
  await checkDisconnectedServer(driver, devframe, devtools);
  await checkReconnectedView(driver, devtools);
}

async function checkReconnectedView(driver: Driver, host: ServerHost): Promise<void> {
  const providerId = host.provider.provider.id;
  await retainViewButton(driver, providerId);
  await driver.findElement(By.css('#disconnect')).click();
  await result(driver, /^Disconnected$/u, '#status');
  assert.equal((await driver.findElements(By.css('#server-views > *'))).length, 0);
  await clickRetainedViewButton(driver);
  assert.equal(await readCounter(host), 4);
  await driver.navigate().refresh();
  await result(driver, /^Connected$/u, '#status');
  await connect(driver, host, host.token);
  await result(driver, /^"Connected example\.devtools"$/u);
  await viewText(driver, providerId, 4);
  assert.equal(
    (await driver.findElements(By.css(`[data-provider="${providerId}"] [data-view]`))).length,
    1,
  );
  await clickView(driver, providerId);
  await viewText(driver, providerId, 5);
  assert.equal(await readCounter(host), 5);
  await counter(driver, 16);
}

async function checkDisconnectedServer(
  driver: Driver,
  devframe: ServerHost,
  devtools: ServerHost,
): Promise<void> {
  await devframe.close();
  await driver.wait(
    async () =>
      (await driver.findElements(By.css('[data-provider="example.devframe"]'))).length === 0,
    10_000,
  );
  await viewText(driver, 'example.devtools', 3);
  await driver.wait(
    until.elementTextContains(driver.findElement(By.css('#providers')), '"status":"unknown"'),
    10_000,
  );
  await driver.findElement(By.css('#fallback-increase')).click();
  await result(driver, /^16$/u);
  await dispatchJson(driver, 'servers', 'shared.example.test');
  await result(driver, /rejected/u, '#json-result');
  assert.equal(await readCounter(devtools), 4);
  await viewText(driver, 'example.devtools', 4);
}

async function checkDeniedOrigin(driver: Driver): Promise<void> {
  await using cleanup = new AsyncDisposableStack();
  const denied = await createRemoteHost('devframe');
  cleanup.defer(denied.close);
  await connect(driver, denied, denied.token);
  await result(driver, /^error$/u);
  assert.equal(await readCounter(denied), 0);
  assert.doesNotMatch(await driver.findElement(By.css('#providers')).getText(), /example\.remote/u);
}

async function checkBroadcast(
  driver: Driver,
  devframe: ServerHost,
  devtools: ServerHost,
): Promise<void> {
  await dispatchJson(driver, 'servers', 'shared.example.test');
  const root = await driver.findElement(By.css('#renderer')).getShadowRoot();
  await driver.wait(
    async () => (await root.findElements(By.css('[role="alert"]'))).length === 0,
    10_000,
  );
  assert.equal(await readCounter(devframe), 1);
  assert.equal(await readCounter(devtools), 1);
  await counter(driver, 14);
  await dispatchJson(driver, 'all', 'shared.example.test');
  assert.equal(await readCounter(devframe), 2);
  assert.equal(await readCounter(devtools), 2);
  await counter(driver, 15);
  await dispatchJson(driver, 'all', 'dev.example.test');
  await result(driver, /not-applicable/u, '#json-result');
  assert.equal(await readCounter(devframe), 3);
  assert.equal(await readCounter(devtools), 3);
  await counter(driver, 15);
  await dispatchJson(driver, 'all', 'unknown.example.test');
  await result(driver, /not-applicable/u, '#json-result');
  const outcomes = await driver.findElement(By.css('#json-result')).getText();
  assert.equal(outcomes.match(/not-applicable/gu)?.length, 3);
  assert.equal(await readCounter(devframe), 3);
  assert.equal(await readCounter(devtools), 3);
  await counter(driver, 15);
  await dispatchJson(driver, 'devframe', 'unknown.example.test');
  await result(driver, /not-applicable/u, '#json-result');
  const selected = await driver.findElement(By.css('#json-result')).getText();
  assert.match(selected, /example\.devframe/u);
  assert.doesNotMatch(selected, /example\.devtools|example\.extension/u);
}

async function dispatchJson(driver: Driver, selection: string, domain: string): Promise<void> {
  await clickJson(driver, selection, domain);
  await result(driver, /fulfilled/u, '#json-result');
}

async function checkMissingServers(driver: Driver): Promise<void> {
  await clickJson(driver, 'servers', 'shared.example.test');
  await result(driver, /Broadcast was not dispatched/u, '#json-result');
  const root = await driver.findElement(By.css('#renderer')).getShadowRoot();
  const alert = await root.findElement(By.css('[role="alert"]'));
  await driver.wait(until.elementTextContains(alert, 'Broadcast was not dispatched'), 10_000);
}

async function clickJson(driver: Driver, selection: string, domain: string): Promise<void> {
  await driver.findElement(By.css(`#json-selection option[value="${selection}"]`)).click();
  const root = await driver.findElement(By.css('#renderer')).getShadowRoot();
  const input = await root.findElement(By.css('input'));
  await input.clear();
  await input.sendKeys(domain);
  const buttons = await root.findElements(By.css('button'));
  const matching = buttons[1];
  assert.ok(matching !== undefined);
  assert.equal(await matching.getText(), 'Increase matching domain');
  await matching.click();
}

async function counter(driver: Driver, value: number): Promise<void> {
  const root = await driver.findElement(By.css('#renderer')).getShadowRoot();
  const content = await root.findElement(By.css('.devframes-json-render-scroll-root'));
  await driver.wait(
    until.elementTextMatches(content, new RegExp(`Counter: ${value}\\b`, 'u')),
    10_000,
  );
}

async function connect(driver: Driver, host: ServerHost, token: string): Promise<void> {
  await fill(driver, '#server-url', `${host.origin}/__devkit-remote/`);
  await fill(driver, '#server-id', host.provider.provider.id);
  await fill(driver, '#server-token', token);
  await driver.findElement(By.css('#server-form button')).click();
  assert.equal(await driver.findElement(By.css('#server-token')).getAttribute('value'), '');
}

async function fill(driver: Driver, selector: string, value: string): Promise<void> {
  const input = driver.findElement(By.css(selector));
  await input.clear();
  await input.sendKeys(value);
}

async function result(
  driver: Driver,
  expected: RegExp,
  selector = '#server-result',
): Promise<void> {
  await driver.wait(
    until.elementTextMatches(driver.findElement(By.css(selector)), expected),
    10_000,
    `Expected server result to match ${expected}`,
  );
}

async function readCounter(host: ServerHost): Promise<number> {
  const resolution = await host.provider.resolve({ capability: counterCapability });
  if (resolution.status !== 'available') throw new Error('Server counter is unavailable');
  return resolution.binding.api.read({});
}
