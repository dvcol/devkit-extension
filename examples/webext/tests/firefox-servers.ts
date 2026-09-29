import assert from 'node:assert/strict';
import { createRemoteHost } from '@devkit/example-server-contexts';
import { counterCapability } from '@devkit/example-contribution';
import { By, until } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';

type ServerHost = Awaited<ReturnType<typeof createRemoteHost>>;

export async function checkFirefoxServers(driver: Driver): Promise<void> {
  await using cleanup = new AsyncDisposableStack();
  const allowedOrigins = [await driver.executeScript<string>('return location.origin')];
  const denied = await createRemoteHost('devframe');
  cleanup.defer(denied.close);
  await connect(driver, denied, denied.token);
  await result(driver, /^error$/u);
  assert.equal(await readCounter(denied), 0);
  assert.doesNotMatch(await driver.findElement(By.css('#providers')).getText(), /example\.remote/u);
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
  await fill(driver, '#preferred-server', 'example.devframe');
  await driver.findElement(By.css('#fallback-increase')).click();
  await result(driver, /^3$/u);
  assert.equal(await readCounter(devframe), 3);
  assert.equal(await readCounter(devtools), 2);
  await devframe.close();
  await driver.wait(
    until.elementTextContains(driver.findElement(By.css('#providers')), '"status":"unknown"'),
    10_000,
  );
  await driver.findElement(By.css('#fallback-increase')).click();
  await result(driver, /^16$/u);
  await driver.findElement(By.css('#servers-increase')).click();
  await result(driver, /rejected/u);
  await result(driver, /fulfilled/u);
  assert.equal(await readCounter(devtools), 3);
}

async function checkBroadcast(
  driver: Driver,
  devframe: ServerHost,
  devtools: ServerHost,
): Promise<void> {
  await driver.findElement(By.css('#servers-increase')).click();
  await result(driver, /fulfilled/u);
  assert.equal(await readCounter(devframe), 1);
  assert.equal(await readCounter(devtools), 1);
  await counter(driver, 14);
  await driver.findElement(By.css('#all-increase')).click();
  await result(driver, /fulfilled/u);
  assert.equal(await readCounter(devframe), 2);
  assert.equal(await readCounter(devtools), 2);
  await counter(driver, 15);
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

async function result(driver: Driver, expected: RegExp): Promise<void> {
  await driver.wait(
    until.elementTextMatches(driver.findElement(By.css('#server-result')), expected),
    10_000,
    `Expected server result to match ${expected}`,
  );
}

async function readCounter(host: ServerHost): Promise<number> {
  const resolution = await host.provider.resolve({ capability: counterCapability });
  if (resolution.status !== 'available') throw new Error('Server counter is unavailable');
  return resolution.binding.api.read({});
}
