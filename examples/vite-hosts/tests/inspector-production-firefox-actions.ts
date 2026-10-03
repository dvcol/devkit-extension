import assert from 'node:assert/strict';
import { By } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';
import { connectInspector } from './inspector-firefox-actions.ts';
import type { InspectorPage } from './inspector-firefox-actions.ts';
import {
  inspectorAssets,
  inspectorProductionFixture,
  settledInspectorBuild,
} from './inspector-production-fixture.ts';

type Fixture = Awaited<ReturnType<typeof inspectorProductionFixture>>;

export async function checkInspectorProduction(driver: Driver, host: 'devframe' | 'devtools') {
  await using cleanup = new AsyncDisposableStack();
  const fixture = await inspectorProductionFixture(host);
  cleanup.defer(fixture.close);
  const initial = await settledInspectorBuild(fixture.output, 'ready');
  const assets = await inspectorAssets(fixture.origin);
  const first = { driver, host, origin: fixture.origin, window: await driver.getWindowHandle() };
  const provider = await connectInspector(first);
  await driver.switchTo().newWindow('tab');
  const second = { ...first, window: await driver.getWindowHandle() };
  assert.deepEqual(await connectInspector(second), provider);
  await customRenderer(second);
  await action(first, 'Inspect response', 'Inspection dispatch complete');
  await waitText(first, 'Response body: fixture:original');
  await action(first, 'Enable response modification', 'Configuration dispatch complete');
  await action(first, 'Inspect response', 'Inspection dispatch complete');
  await waitText(second, 'Response body: native:fixture:original');
  const marker = await checkMarker(first, fixture, assets.html);
  const originalDocument = (await readView(first)).document;
  const failed = await checkFailedBuild({ first, second, fixture, initial, assets });
  const recovered = await checkRecoveredBuild({ first, second, fixture, failed, provider });
  assert.equal((await readView(first)).document, originalDocument);
  assert.deepEqual(await inspectorAssets(assets.url), assets);
  await fixture.server.close();
  for (const page of [first, second]) await disconnected(page);
  await driver.switchTo().window(second.window);
  await driver.close();
  await driver.switchTo().window(first.window);
  await driver.get('about:blank');
  return {
    host,
    origin: fixture.origin,
    provider,
    initial,
    marker,
    failed,
    recovered,
    originalDocumentRetained: true,
    oldAssetsRetained: true,
  };
}

async function readView({ driver, window }: InspectorPage) {
  await driver.switchTo().window(window);
  const current = await driver.executeScript<{
    text: string;
    alert: string;
    connection: string;
    overlay: boolean;
    provider: string;
    firstScript: string;
    document: number;
    custom: boolean;
    disabled: number;
  }>(() => {
    const mount = document.querySelector('#inspector > div');
    const root = mount?.shadowRoot ?? mount;
    function text(selector: string): string {
      return root?.querySelector<HTMLElement>(selector)?.innerText ?? '';
    }
    return {
      text: text('.devframes-json-render-scroll-root, [data-renderer="custom"]'),
      alert: text('[role="alert"]'),
      connection: document.querySelector('#connection')!.textContent ?? '',
      overlay: document.querySelector('vite-error-overlay') !== null,
      provider: document.querySelector('#provider')!.textContent ?? '',
      firstScript: document.querySelector('#marker-observation')!.textContent ?? '',
      document: performance.timeOrigin,
      custom: root?.querySelector('[data-renderer="custom"]') !== null,
      disabled: root?.querySelectorAll('button:disabled').length ?? 0,
    };
  });
  assert.equal(current.connection, 'Connected');
  assert.equal(current.overlay, false);
  if (current.alert !== '')
    assert.equal(
      current.alert,
      'Action "example.response-inspector.marker" failed: Operation handler failed',
    );
  return current;
}

async function waitText(page: InspectorPage, text: string) {
  await page.driver.wait(async () => (await readView(page)).text.includes(text), 10_000);
}

async function action(page: InspectorPage, label: string, outcome: string) {
  const { driver } = page;
  const current = await readView(page);
  const mount = await driver.findElement(By.css('#inspector > div'));
  const root = current.custom ? mount : await mount.getShadowRoot();
  const buttons = await root.findElements(By.css('button'));
  const labels = await Promise.all(buttons.map((button) => button.getText()));
  const button = buttons[labels.indexOf(label)];
  assert.ok(button, `Missing inspector action: ${label}`);
  await driver.wait(() => button.isEnabled(), 10_000);
  await button.click();
  await driver.wait(async () => {
    const view = await readView(page);
    return view.disabled === 0 && view.text.includes(outcome);
  }, 10_000);
}

async function customRenderer(page: InspectorPage) {
  const { driver, window } = page;
  await driver.switchTo().window(window);
  await driver.wait(() => driver.findElement(By.id('inspector-renderer')).isEnabled(), 10_000);
  await driver.findElement(By.css('#inspector-renderer option[value="custom"]')).click();
  await driver.wait(async () => (await readView(page)).custom, 10_000);
}

async function checkMarker(page: InspectorPage, fixture: Fixture, html: string) {
  await action(page, 'Install page marker', 'Marker installation failed');
  const current = await readView(page);
  assert.match(current.alert, /Operation handler failed/u);
  assert.match(current.text, /Marker installed: false/u);
  const firstScript = JSON.parse(current.firstScript) as unknown;
  assert.deepEqual(firstScript, { marker: null, readyState: 'loading' });
  assert.equal((await inspectorAssets(fixture.origin)).html, html);
  await action(page, 'Inspect response', 'Inspection dispatch complete');
  await waitText(page, 'Response body: native:fixture:original');
  assert.equal((await readView(page)).alert, current.alert);
  return {
    outcome: 'Marker installation failed',
    alert: current.alert,
    firstScript,
    builtHtmlUnchanged: true,
    readStillWorks: true,
  };
}

async function checkFailedBuild(options: {
  first: InspectorPage;
  second: InspectorPage;
  fixture: Fixture;
  initial: Awaited<ReturnType<typeof settledInspectorBuild>>;
  assets: Awaited<ReturnType<typeof inspectorAssets>>;
}) {
  const { first, second, fixture, initial, assets } = options;
  await fixture.invalidate();
  const failed = await settledInspectorBuild(fixture.output, 'failed', initial.attempt);
  assert.equal(failed.generation, initial.generation);
  assert.match(failed.error ?? '', /Unexpected token|Parse failure/u);
  assert.deepEqual(await inspectorAssets(fixture.origin), assets);
  assert.deepEqual(await (await fetch(`${fixture.origin}/__build-status`)).json(), failed);
  await action(second, 'Reset inspector', 'Reset dispatch complete');
  await action(second, 'Inspect response', 'Inspection dispatch complete');
  await waitText(first, 'Response body: fixture:original');
  assert.equal(
    await first.driver.findElement(By.css('h1')).getText(),
    'Portable response inspector',
  );
  return failed;
}

async function checkRecoveredBuild(options: {
  first: InspectorPage;
  second: InspectorPage;
  fixture: Fixture;
  failed: Awaited<ReturnType<typeof settledInspectorBuild>>;
  provider: unknown;
}) {
  const { first, second, fixture, failed, provider } = options;
  assert.deepEqual(await connectInspector(second), provider);
  await waitText(second, 'Response body: fixture:original');
  await fixture.recover();
  const recovered = await settledInspectorBuild(fixture.output, 'ready', failed.attempt);
  assert.notEqual(recovered.generation, failed.generation);
  assert.deepEqual(await connectInspector(second), provider);
  await second.driver.wait(
    async () =>
      (await second.driver.findElement(By.css('h1')).getText()) === 'Updated production inspector',
    10_000,
  );
  await waitText(first, 'Response body: fixture:original');
  assert.equal(
    await first.driver.findElement(By.css('h1')).getText(),
    'Portable response inspector',
  );
  await customRenderer(second);
  await action(second, 'Enable response modification', 'Configuration dispatch complete');
  await action(second, 'Inspect response', 'Inspection dispatch complete');
  await waitText(first, 'Response body: native:fixture:original');
  assert.deepEqual(JSON.parse((await readView(first)).provider) as unknown, provider);
  return recovered;
}

async function disconnected({ driver, window }: InspectorPage) {
  await driver.switchTo().window(window);
  await driver.wait(
    async () =>
      (await driver.findElement(By.id('connection')).getText()) ===
      'Disconnected. Reload to reconnect.',
    10_000,
  );
  assert.equal((await driver.findElements(By.css('#inspector > *'))).length, 0);
  assert.equal(await driver.findElement(By.id('inspector-renderer')).isEnabled(), false);
}
