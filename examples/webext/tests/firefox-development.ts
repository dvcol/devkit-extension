import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { styleText } from 'node:util';
import { By, until } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';
import { createServer } from 'wxt';
import {
  availablePort,
  createDevelopmentFixture,
  updateDevelopmentVersion,
} from './development-fixture.ts';
import { attachFirefox } from './firefox-development-observer.ts';
import { checkFirefoxScriptReload } from './firefox-script-reload.ts';
import { checkFirefoxDevelopmentHosts } from './firefox-development-hosts.ts';

const fixture = await createDevelopmentFixture();
const artifactDirectory = 'artifacts/firefox-development';
let server: Awaited<ReturnType<typeof createServer>> | undefined;
let observer: Awaited<ReturnType<typeof attachFirefox>> | undefined;
let driver: Driver;
let manifestVersion: string | undefined;

try {
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(`${artifactDirectory}/receipt.json`, JSON.stringify({ passed: false }));
  const marionettePort = await availablePort();
  const binaries: Record<string, string> = {};
  if (process.env.FIREFOX_BINARY !== undefined) binaries.firefox = process.env.FIREFOX_BINARY;
  server = await createServer({
    root: fixture,
    browser: 'firefox',
    dev: { server: { port: await availablePort() } },
    webExt: {
      binaries,
      firefoxArgs: ['--headless', '--marionette', '--remote-allow-system-access'],
      firefoxPref: { 'marionette.port': marionettePort },
    },
  });
  await server.start();
  observer = await attachFirefox(marionettePort);
  ({ driver } = observer);
  await driver.switchTo().newWindow('tab');
  await driver.get(`${observer.origin}/panel.html`);
  await connected(0);
  await increase();
  await counter(1);
  await checkModuleUpdate();
  await checkHtmlReload();
  await checkFirefoxDevelopmentHosts(driver, fixture);
  await checkBackgroundReload(observer.origin);
  manifestVersion = await checkConfigurationRestart(marionettePort);
  await checkFirefoxScriptReload(driver, fixture);
  await writeFile(`${artifactDirectory}/panel.png`, await driver.takeScreenshot(), 'base64');
} finally {
  const cleanup = [
    ...(await Promise.allSettled([server?.stop()])),
    ...(await Promise.allSettled([observer?.dispose()])),
    ...(await Promise.allSettled([rm(fixture, { recursive: true, force: true })])),
  ];
  assert.equal(
    cleanup.find((result) => result.status === 'rejected'),
    undefined,
  );
}
await writeFile(
  `${artifactDirectory}/receipt.json`,
  JSON.stringify(
    {
      passed: true,
      browserVersion: observer.browserVersion,
      manifestVersion,
      nativeStopClosedBrowser: true,
      scenarios: [
        'Packaged MAIN script edit reloads extension, removes temporary registration, preserves the old document, and needs explicit registration before fresh navigation',
        'Panel module HMR preserves document, provider and state; replaces caller; invokes each action once',
        'HTML reload replaces document while retaining provider and state',
        'Native toolbar popup module HMR preserves document, provider and state; replaces caller; one pointer action reaches the peer; popup closes cleanly',
        'Native toolbar popup HTML reload replaces document and caller, retains provider/state and invokes one pointer JSON action observed by the peer',
        'Native DevTools panel module HMR retains document and HTML reload replaces it; both replace caller, retain provider/state and invoke one JSON action observed by the peer; native close removes the toolbox',
        'DevTools registration module edit removes its tab; native toolbox reopen adopts one updated tab with retained provider/state and one JSON action effect',
        'Native sidebar module HMR retains document and HTML reload replaces it; both replace caller, retain provider/state and invoke one pointer JSON action observed by the peer; native close removes the view',
        'Background reload closes old extension page; new page receives new incarnation and reset state',
        'Config restart closes old Firefox; replacement runs manifest 0.0.2 with a new provider and working actions',
      ],
    },
    null,
    2,
  ) + '\n',
);
console.info(
  styleText('green', '✅ [webext/firefox-development]'),
  'Native panel, popup, DevTools and sidebar HMR, HTML/background reload, configuration restart and cleanup passed',
);

async function checkModuleUpdate(): Promise<void> {
  const timeOrigin = await driver.executeScript<number>('return performance.timeOrigin');
  const provider = await text('#provider');
  const previousIdentity = await identity();
  const marker = crypto.randomUUID();
  await appendFile(
    `${fixture}/src/panel.ts`,
    `\ndocument.body.dataset.developmentUpdate = ${JSON.stringify(marker)};\n`,
  );
  await driver.wait(
    () =>
      driver.executeScript<boolean>(
        'return document.body.dataset.developmentUpdate === arguments[0]',
        marker,
      ),
    30_000,
  );
  await connected(1);
  assert.equal(await driver.executeScript<number>('return performance.timeOrigin'), timeOrigin);
  assert.equal(await text('#provider'), provider);
  assert.notEqual(await identity(), previousIdentity);
  const renderer = await driver.findElement(By.id('renderer')).getShadowRoot();
  const buttons = await renderer.findElements(By.css('button'));
  assert.deepEqual(await Promise.all(buttons.map((button) => button.getText())), [
    'Increase counter',
    'Increase matching domain',
  ]);
  await click('#routed');
  await waitText('#result', '2');
  await increase();
  await counter(3);
}

async function checkHtmlReload(): Promise<void> {
  const timeOrigin = await driver.executeScript<number>('return performance.timeOrigin');
  const provider = await text('#provider');
  const htmlPath = `${fixture}/entrypoints/panel.html`;
  const source = await readFile(htmlPath, 'utf8');
  await writeFile(
    htmlPath,
    source.replace('<h1>Native Port proof</h1>', '<h1>Updated native Port proof</h1>'),
  );
  await waitText('h1', 'Updated native Port proof');
  await connected(3);
  assert.notEqual(await driver.executeScript<number>('return performance.timeOrigin'), timeOrigin);
  assert.equal(await text('#provider'), provider);
  await click('#routed');
  await waitText('#result', '4');
  await counter(4);
}

async function checkBackgroundReload(origin: string): Promise<void> {
  const provider = await text('#provider');
  const previousWindow = await driver.getWindowHandle();
  await appendFile(
    `${fixture}/entrypoints/background.ts`,
    '\nconsole.info("Development background replacement");\n',
  );
  await driver.wait(
    async () => !(await driver.getAllWindowHandles()).includes(previousWindow),
    30_000,
  );
  const [remainingWindow] = await driver.getAllWindowHandles();
  assert.ok(typeof remainingWindow === 'string');
  await driver.switchTo().window(remainingWindow);
  await driver.switchTo().newWindow('tab');
  await driver.get(`${origin}/panel.html`);
  await connected(0);
  assert.notEqual(await text('#provider'), provider);
  await click('#routed');
  await waitText('#result', '1');
  await counter(1);
}

async function checkConfigurationRestart(marionettePort: number): Promise<string> {
  const previousObserver = observer;
  assert.ok(previousObserver !== undefined);
  const provider = await text('#provider');
  assert.equal(
    await driver.executeScript<string>('return chrome.runtime.getManifest().version'),
    '0.0.1',
  );
  await updateDevelopmentVersion(fixture);
  await previousObserver.dispose();
  observer = await attachFirefox(marionettePort);
  assert.notEqual(observer.processId, previousObserver.processId);
  ({ driver } = observer);
  await driver.get(`${observer.origin}/panel.html`);
  await connected(0);
  assert.notEqual(await text('#provider'), provider);
  const version = await driver.executeScript<string>('return chrome.runtime.getManifest().version');
  assert.equal(version, '0.0.2');
  await click('#routed');
  await waitText('#result', '1');
  await increase();
  await counter(2);
  return version;
}

async function connected(value: number): Promise<void> {
  await waitText('#status', 'Connected');
  await waitText('#catalog', 'active');
  await counter(value);
}

async function identity(): Promise<string> {
  await click('#identity');
  await driver.wait(
    until.elementTextContains(driver.findElement(By.id('result')), 'panel.html'),
    10_000,
  );
  return text('#result');
}

async function increase(): Promise<void> {
  const root = await driver.findElement(By.id('renderer')).getShadowRoot();
  const button = await root.findElement(By.css('button'));
  await button.click();
}

async function counter(value: number): Promise<void> {
  const root = await driver.findElement(By.id('renderer')).getShadowRoot();
  const content = await root.findElement(By.css('.devframes-json-render-scroll-root'));
  await driver.wait(
    until.elementTextMatches(content, new RegExp(`Counter: ${value}\\b`, 'u')),
    30_000,
  );
}

async function click(selector: string): Promise<void> {
  await driver.findElement(By.css(selector)).click();
}

function text(selector: string): Promise<string> {
  return driver.findElement(By.css(selector)).getText();
}

async function waitText(selector: string, expected: string): Promise<void> {
  await driver.wait(
    () =>
      driver.executeScript<boolean>(
        'return document.querySelector(arguments[0])?.textContent === arguments[1]',
        selector,
        expected,
      ),
    30_000,
  );
}
