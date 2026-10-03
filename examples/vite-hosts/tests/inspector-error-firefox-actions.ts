import assert from 'node:assert/strict';
import { By, WebElement } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';
import type { ResponseFailure } from './inspector-error-actions.ts';

interface RendererPage {
  driver: Driver;
  renderer: 'reference' | 'custom';
}

/** Native calls reject through the unchanged authored onError callback in either renderer. */
export async function checkInspectorError(page: RendererPage & { failure: ResponseFailure }) {
  const { driver, failure, renderer } = page;
  await selectRenderer(page);
  await action(page, 'Enable response modification', 'Configuration dispatch complete');
  await action(page, 'Inspect response', 'Inspection dispatch complete');
  const before = await state(driver);
  assert.equal(before.body, 'Response body: native:fixture:original');
  assert.equal(before.alert, '');
  const mount = await driver.findElement(By.css('#inspector > div'));
  try {
    failure.active = true;
    const initialRequests = failure.requests;
    await action(page, 'Inspect response', 'Inspection failed');
    assert.ok(failure.requests > initialRequests, 'The backend attempted the failing HTTP read');
    const failed = await state(driver);
    assert.equal(failed.body, before.body);
    assert.equal(failed.configuration, before.configuration);
    assert.equal(failed.document, before.document);
    assert.match(failed.alert, /Operation handler failed/u);
    failure.active = false;
    const recovery = await checkRecovery(page);
    assert.equal(recovery.document, before.document);
    assert.equal(recovery.provider, before.provider);
    assert.equal(
      await WebElement.equals(mount, driver.findElement(By.css('#inspector > div'))),
      true,
    );
    return {
      renderer,
      provider: JSON.parse(before.provider) as unknown,
      before,
      failed,
      recovery,
      failedRequests: failure.requests - initialRequests,
    };
  } finally {
    failure.active = false;
  }
}

async function selectRenderer({ driver, renderer }: RendererPage) {
  await driver.wait(() => driver.findElement(By.id('inspector-renderer')).isEnabled(), 10_000);
  await driver.findElement(By.css(`#inspector-renderer option[value="${renderer}"]`)).click();
  await driver.wait(async () => {
    const current = await state(driver);
    return current.buttons === 5 && current.custom === (renderer === 'custom');
  }, 10_000);
}

async function action(page: RendererPage, label: string, outcome: string) {
  const { driver, renderer } = page;
  const mount = await driver.findElement(By.css('#inspector > div'));
  const root = renderer === 'custom' ? mount : await mount.getShadowRoot();
  const buttons = await root.findElements(By.css('button'));
  const labels = await Promise.all(buttons.map((button) => button.getText()));
  const button = buttons[labels.indexOf(label)];
  assert.ok(button, `Missing inspector action: ${label}`);
  await driver.wait(() => button.isEnabled(), 10_000);
  await button.click();
  await driver.wait(async () => (await state(driver)).outcome === outcome, 10_000);
}

async function state(driver: Driver) {
  const current = await driver.executeScript<{
    text: string;
    alert: string;
    document: number;
    provider: string;
    connection: string;
    overlay: boolean;
    buttons: number;
    disabled: number;
    custom: boolean;
  }>(() => {
    const mount = document.querySelector('#inspector > div');
    const root = mount?.shadowRoot ?? mount;
    function text(selector: string): string {
      return root?.querySelector<HTMLElement>(selector)?.innerText ?? '';
    }
    return {
      text: text('.devframes-json-render-scroll-root, [data-renderer="custom"]'),
      alert: text('[role="alert"]'),
      document: performance.timeOrigin,
      provider: document.querySelector('#provider')!.textContent ?? '',
      connection: document.querySelector('#connection')!.textContent ?? '',
      overlay: document.querySelector('vite-error-overlay') !== null,
      buttons: root?.querySelectorAll('button').length ?? 0,
      disabled: root?.querySelectorAll('button:disabled').length ?? 0,
      custom: root?.querySelector('[data-renderer="custom"]') !== null,
    };
  });
  assert.equal(current.overlay, false);
  assert.equal(current.connection, 'Connected');
  const lines = current.text.split('\n');
  return {
    ...current,
    body: lines.find((line) => line.startsWith('Response body:')),
    configuration: lines.find((line) => line.startsWith('Modification enabled:')),
    outcome: lines.find((line) =>
      /^(Inspection|Configuration|Reset|Marker) (dispatch complete|failed)$/u.test(line),
    ),
  };
}

async function checkRecovery(page: RendererPage) {
  await action(page, 'Reset inspector', 'Reset dispatch complete');
  const reset = await state(page.driver);
  assert.equal(reset.body, 'Response body: No response inspected');
  assert.equal(reset.configuration, 'Modification enabled: false');
  await action(page, 'Inspect response', 'Inspection dispatch complete');
  const recovered = await state(page.driver);
  assert.equal(recovered.body, 'Response body: fixture:original');
  assert.equal(recovered.alert, '');
  assert.equal(recovered.disabled, 0);
  return recovered;
}
