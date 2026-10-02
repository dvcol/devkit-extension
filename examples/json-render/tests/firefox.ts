import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { styleText } from 'node:util';
import { createJsonRenderExample } from '@devkit/example-json-render';
import { counterStateKey, increaseCounterAction } from '@devkit/example-contribution';
import { By, until } from 'selenium-webdriver';
import { Driver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';
import { counterSpec } from '../src/spec.ts';
import { serve } from './browser-fixture.ts';
import { clickAction, readView, viewCounter, viewEmpty } from './firefox-view.ts';

type NativeExample = Awaited<ReturnType<typeof createJsonRenderExample>>;

const options = new Options().addArguments('-headless');
if (process.env.FIREFOX_BINARY !== undefined) options.setBinary(process.env.FIREFOX_BINARY);
const driver = Driver.createSession(options, new ServiceBuilder().build());
try {
  await mkdir('artifacts', { recursive: true });
  const observations = [];
  for (const mode of ['devframe', 'devtools'] as const) observations.push(await checkHost(mode));
  const capabilities = await driver.getCapabilities();
  const receipt = {
    browser: capabilities.getBrowserVersion(),
    driver: capabilities.get('moz:geckodriverVersion') as unknown,
    observations,
    checks: observations.flatMap(({ mode, checks }) => checks.map((check) => `${mode}: ${check}`)),
    limitations: [
      'No global page-error capture through WebDriver Classic',
      'Delayed native state-response replacement remains covered by the separate Chromium test',
      'Renderer-module HMR, injected rendering and complete catalog conformance remain unproved',
    ],
  };
  await writeFile('artifacts/firefox-renderers.json', JSON.stringify(receipt, null, 2) + '\n');
  console.info(styleText('green', '✅ [json-render/firefox]'), receipt);
} finally {
  await driver.quit();
}

async function checkHost(mode: 'devframe' | 'devtools') {
  await using cleanup = new AsyncDisposableStack();
  const example = await createJsonRenderExample(mode);
  cleanup.defer(example.close);
  const server = await serve(example);
  cleanup.defer(() => server.close());
  const origin = server.resolvedUrls?.local[0];
  assert.ok(typeof origin === 'string' && origin.length > 0);
  const reference = await driver.getWindowHandle();
  await driver.get(origin);
  await viewCounter(driver, 0);
  await driver.switchTo().newWindow('tab');
  const custom = await driver.getWindowHandle();
  cleanup.defer(async () => {
    await driver.switchTo().window(custom);
    await driver.close();
    await driver.switchTo().window(reference);
  });
  await driver.get(origin);
  await chooseRenderer('custom', 0);
  await checkActions(reference, example);
  await checkReplacement(reference, example);
  await checkUnsupported(example);
  await clickAction(driver, 'Increase counter');
  await bothCounters(reference, 5);
  await checkContributionLifetime(reference, example);
  await writeFile(`artifacts/firefox-${mode}.png`, await driver.takeScreenshot(), 'base64');
  await example.close();
  await checkClosed(reference);
  assert.equal(example.host.provider.catalog.snapshot().status, 'disposed');
  return { mode, checks: scenarioChecks(), finalValue: 7, providerDisposed: true };
}

function scenarioChecks(): string[] {
  return [
    'unchanged JSON view with reference and custom renderer',
    'native action and state shared across both rendered pages',
    'native invalid input is displayed without mutating state; valid action clears custom error',
    'unmount removes DOM and subscriptions; retained detached button cannot dispatch',
    'remount reads current state; unregister restores reference renderer',
    'unsupported component fails explicitly on update and mount; valid remount recovers',
    'view disable and dependency loss remove both mounts; reenable republishes current business state',
    'host disconnect disposes both views and controls',
  ];
}

async function chooseRenderer(renderer: 'custom' | 'reference', value: number): Promise<void> {
  await driver.wait(until.elementIsEnabled(driver.findElement(By.id('renderer'))), 10_000);
  await driver.findElement(By.css(`#renderer option[value="${renderer}"]`)).click();
  await driver.wait(
    async () => {
      const view = await readView(driver);
      return renderer === 'custom' ? view.customViews === 1 : view.referenceViews === 1;
    },
    10_000,
    `Expected one ${renderer} renderer mount`,
  );
  await viewCounter(driver, value);
}

/** Each helper returns to the custom-renderer page, keeping ownership explicit. */
async function bothCounters(reference: string, value: number): Promise<void> {
  const custom = await driver.getWindowHandle();
  await viewCounter(driver, value);
  await driver.switchTo().window(reference);
  await viewCounter(driver, value);
  await driver.switchTo().window(custom);
}

async function checkActions(reference: string, example: NativeExample): Promise<void> {
  await clickAction(driver, 'Increase counter');
  await bothCounters(reference, 1);
  await clickAction(driver, 'Try invalid input');
  await driver.wait(async () => /valid/iu.test((await readView(driver)).alert), 10_000);
  await bothCounters(reference, 1);
  assert.deepEqual(example.view.value().state, { value: 1 });
  await clickAction(driver, 'Increase counter');
  await bothCounters(reference, 2);
  await driver.wait(async () => (await readView(driver)).alert === '', 10_000);
}

async function checkReplacement(reference: string, example: NativeExample): Promise<void> {
  await driver.executeScript(() => {
    const view = document.querySelector('[data-renderer="custom"]');
    if (view === null) throw new Error('Custom view is unavailable');
    Reflect.set(window, 'retainedCustomView', view);
  });
  await driver.findElement(By.id('unmount')).click();
  await viewEmpty(driver);
  const custom = await driver.getWindowHandle();
  await driver.switchTo().window(reference);
  await clickAction(driver, 'Increase counter');
  await viewCounter(driver, 3);
  await driver.switchTo().window(custom);
  const retained = await driver.executeScript<{ connected: boolean; text: string }>(() => {
    const view: unknown = Reflect.get(window, 'retainedCustomView');
    if (!(view instanceof HTMLElement)) throw new Error('Retained custom view is unavailable');
    view.querySelector('button')?.click();
    Reflect.deleteProperty(window, 'retainedCustomView');
    return { connected: view.isConnected, text: view.querySelector('p')?.textContent ?? '' };
  });
  assert.equal(retained.connected, false);
  assert.match(retained.text, /Counter: 2\b/u);
  assert.deepEqual(example.view.value().state, { value: 3 });
  await driver.findElement(By.id('mount')).click();
  await viewCounter(driver, 3);
  await chooseRenderer('reference', 3);
  assert.equal((await readView(driver)).customViews, 0);
  await clickAction(driver, 'Increase counter');
  await bothCounters(reference, 4);
  await chooseRenderer('custom', 4);
}

async function checkUnsupported(example: NativeExample): Promise<void> {
  const view = await example.host.context.rpc.sharedState.get<ReturnType<typeof counterSpec>>(
    example.stateKey,
  );
  view.patch([
    {
      op: 'replace',
      path: [],
      value: {
        root: 'badge',
        state: { value: 4 },
        elements: { badge: { type: 'Badge', props: { text: 'Outside the example DOM catalog' } } },
      },
    },
  ]);
  await driver.wait(
    async () => (await readView(driver)).alert.includes('Unsupported component'),
    10_000,
  );
  assert.equal((await readView(driver)).buttons, 0);
  await driver.findElement(By.id('unmount')).click();
  await driver.findElement(By.id('mount')).click();
  await driver.wait(
    until.elementTextIs(
      driver.findElement(By.id('status')),
      'Mount failed: Error: Renderer unavailable: load-error',
    ),
    10_000,
  );
  await viewEmpty(driver);
  view.patch([{ op: 'replace', path: [], value: counterSpec({ value: 4 }) }]);
  await driver.findElement(By.id('mount')).click();
  await viewCounter(driver, 4);
}

async function checkContributionLifetime(reference: string, example: NativeExample): Promise<void> {
  const custom = await driver.getWindowHandle();
  await example.viewPlugin.disable();
  for (const page of [reference, custom]) {
    await driver.switchTo().window(page);
    await viewEmpty(driver);
    assert.equal(await driver.findElement(By.id('mount')).isEnabled(), false);
  }
  assert.equal(
    await example.host.provider.invoke({ action: increaseCounterAction, input: { amount: 1 } }),
    6,
  );
  await example.viewPlugin.enable();
  await bothCounters(reference, 6);
  const service = example.host.provider.startup.services[0];
  assert.ok(service);
  await service.disable();
  for (const page of [reference, custom]) {
    await driver.switchTo().window(page);
    await viewEmpty(driver);
  }
  const state = await example.host.context.rpc.sharedState.get<{ value: number }>(counterStateKey);
  state.mutate((draft) => {
    draft.value = 7;
  });
  await service.enable();
  await bothCounters(reference, 7);
}

async function checkClosed(reference: string): Promise<void> {
  const custom = await driver.getWindowHandle();
  for (const page of [reference, custom]) {
    await driver.switchTo().window(page);
    await viewEmpty(driver);
    assert.equal(await driver.findElement(By.id('mount')).isEnabled(), false);
    assert.equal(await driver.findElement(By.id('renderer')).isEnabled(), false);
  }
}
