import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { styleText } from 'node:util';
import { By, until } from 'selenium-webdriver';
import { Driver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';
import { clickAction, viewCounter } from './firefox-view.ts';
import { createReloadFixture, reloadChecks } from './reload-fixture.ts';

const options = new Options().addArguments('-headless');
if (process.env.FIREFOX_BINARY !== undefined) options.setBinary(process.env.FIREFOX_BINARY);
const driver = Driver.createSession(options, new ServiceBuilder().build());
try {
  const observations = [];
  for (const mode of ['devframe', 'devtools'] as const) observations.push(await checkHost(mode));
  const capabilities = await driver.getCapabilities();
  const receipt = {
    browser: capabilities.getBrowserVersion(),
    driver: capabilities.get('moz:geckodriverVersion') as unknown,
    observations,
    checks: observations.flatMap(({ mode }) => reloadChecks.map((check) => `${mode}: ${check}`)),
    limitations: ['No global page-error capture through WebDriver Classic'],
  };
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/firefox-reload.json', JSON.stringify(receipt, null, 2) + '\n');
  console.info(styleText('green', '✅ [json-render/reload/firefox]'), receipt);
} finally {
  await driver.quit();
}

async function chooseCustom(value: number): Promise<void> {
  await driver.wait(until.elementIsEnabled(driver.findElement(By.id('renderer'))), 10_000);
  await driver.findElement(By.css('#renderer option[value="custom"]')).click();
  await driver.wait(until.elementLocated(By.css('[data-renderer="custom"]')), 10_000);
  await viewCounter(driver, value);
}

async function checkHost(mode: 'devframe' | 'devtools') {
  await using cleanup = new AsyncDisposableStack();
  const fixture = await createReloadFixture(mode);
  cleanup.defer(fixture.close);
  const provider = { ...fixture.example.host.provider.provider };
  await driver.get(fixture.origin);
  await viewCounter(driver, 0);
  await chooseCustom(0);
  await clickAction(driver, 'Increase counter');
  await viewCounter(driver, 1);
  const documentBefore = await checkStyle(fixture);
  await fixture.updateRenderer();
  await driver.wait(
    async () =>
      (await driver.executeScript<number>(() => performance.timeOrigin)) !== documentBefore,
    10_000,
  );
  await viewCounter(driver, 2);
  const rendererAfterReload = await driver.findElement(By.id('renderer')).getAttribute('value');
  assert.ok(rendererAfterReload === 'custom' || rendererAfterReload === 'reference');
  if (rendererAfterReload === 'custom')
    await driver.wait(until.elementLocated(By.css('[data-source-version="updated"]')), 10_000);
  await chooseCustom(2);
  assert.equal(
    await driver
      .findElement(By.css('[data-renderer="custom"]'))
      .getAttribute('data-source-version'),
    'updated',
  );
  await clickAction(driver, 'Increase counter');
  await viewCounter(driver, 3);
  assert.deepEqual(fixture.example.view.value().state, { value: 3 });
  assert.deepEqual(fixture.example.host.provider.provider, provider);
  return {
    mode,
    documentBefore,
    documentAfter: await driver.executeScript<number>(() => performance.timeOrigin),
    cssMountRetained: true,
    providerRetained: true,
    rendererAfterReload,
    finalValue: 3,
  };
}

async function checkStyle(
  fixture: Awaited<ReturnType<typeof createReloadFixture>>,
): Promise<number> {
  const documentBefore = await driver.executeScript<number>(() => {
    Reflect.set(window, 'reloadRetainedMount', document.querySelector('[data-renderer="custom"]'));
    return performance.timeOrigin;
  });
  assert.equal(await driver.findElement(By.css('h1')).getCssValue('color'), 'rgb(1, 2, 3)');
  await fixture.updateStyle();
  await driver.wait(
    async () => (await driver.findElement(By.css('h1')).getCssValue('color')) === 'rgb(4, 5, 6)',
    10_000,
  );
  const afterStyle = await driver.executeScript<{ document: number; retained: boolean }>(() => {
    const mount: unknown = Reflect.get(window, 'reloadRetainedMount');
    return {
      document: performance.timeOrigin,
      retained:
        mount instanceof HTMLElement &&
        mount.isConnected &&
        mount === document.querySelector('[data-renderer="custom"]'),
    };
  });
  assert.equal(afterStyle.document, documentBefore);
  assert.equal(afterStyle.retained, true);
  await viewCounter(driver, 1);
  await clickAction(driver, 'Increase counter');
  await viewCounter(driver, 2);
  return documentBefore;
}
