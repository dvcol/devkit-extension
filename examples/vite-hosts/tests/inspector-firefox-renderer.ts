import assert from 'node:assert/strict';
import { By } from 'selenium-webdriver';
import { click, inspectOriginal, snapshot, waitText } from './inspector-firefox-actions.ts';
import type { InspectorPage } from './inspector-firefox-actions.ts';

/** Both tabs use the same genuine provider and its unchanged authored inspector spec. */
export async function checkInspectorRenderer(primary: InspectorPage, peer: InspectorPage) {
  const provider = (await snapshot(primary)).provider;
  assert.deepEqual((await snapshot(peer)).provider, provider);
  await click(primary, 'Reset inspector', 'Reset dispatch complete');
  await waitText(peer, 'Response body: No response inspected');
  await selectRenderer(primary, 'custom');
  await inspectOriginal(primary);
  await waitText(peer, 'Response body: fixture:original');
  assert.doesNotMatch((await snapshot(peer)).text, /Inspection dispatch complete/u);
  const projection = await checkProjection(primary, peer);
  const detached = await checkDetachedControl(primary);
  await selectRenderer(primary, 'custom');
  assert.doesNotMatch((await snapshot(primary)).text, /Inspection dispatch complete/u);
  await click(primary, 'Install page marker', 'Marker dispatch complete');
  await waitText(primary, 'Marker installed: true');
  await click(primary, 'Reset inspector', 'Reset dispatch complete');
  await waitText(primary, 'Marker installed: false');
  await waitText(primary, 'Response body: No response inspected');
  assert.deepEqual((await snapshot(primary)).provider, provider);
  return { provider, projection, detached };
}

async function selectRenderer(page: InspectorPage, renderer: 'reference' | 'custom') {
  const { driver, window } = page;
  await driver.switchTo().window(window);
  await driver.wait(() => driver.findElement(By.id('inspector-renderer')).isEnabled(), 10_000);
  await driver.findElement(By.css(`#inspector-renderer option[value="${renderer}"]`)).click();
  await waitRenderer(page, renderer);
}

async function waitRenderer(page: InspectorPage, renderer: 'reference' | 'custom') {
  await page.driver.wait(async () => {
    const current = await snapshot(page);
    return current.buttons === 5 && current.customViews === (renderer === 'custom' ? 1 : 0);
  }, 10_000);
  assert.equal((await page.driver.findElements(By.css('#inspector > div'))).length, 1);
}

async function checkProjection(primary: InspectorPage, peer: InspectorPage) {
  await click(peer, 'Enable response modification', 'Configuration dispatch complete');
  await waitText(primary, 'Modification enabled: true');
  assert.match((await snapshot(primary)).text, /Inspection dispatch complete/u);
  await click(primary, 'Inspect response', 'Inspection dispatch complete');
  await waitText(primary, 'Response body: native:fixture:original');
  await waitText(peer, 'Response body: native:fixture:original');
  assert.match((await snapshot(peer)).text, /Configuration dispatch complete/u);
  const modified = await snapshot(primary);
  await click(primary, 'Disable response modification', 'Configuration dispatch complete');
  await waitText(primary, 'Modification enabled: false');
  await click(primary, 'Enable response modification', 'Configuration dispatch complete');
  await waitText(primary, 'Modification enabled: true');
  await waitText(peer, 'Modification enabled: true');
  const enabled = await snapshot(primary);
  await click(primary, 'Disable response modification', 'Configuration dispatch complete');
  await waitText(primary, 'Modification enabled: false');
  await waitText(peer, 'Modification enabled: false');
  return { modified, enabled };
}

async function checkDetachedControl(page: InspectorPage) {
  const { driver, window } = page;
  await driver.switchTo().window(window);
  await driver.wait(() => driver.findElement(By.id('inspector-renderer')).isEnabled(), 10_000);
  /** The driver owns this closure because WebDriver element handles reject detached nodes. */
  const connected = await driver.executeAsyncScript<boolean>((done: (value: boolean) => void) => {
    const container = document.querySelector('#inspector')!;
    const button = Array.from(container.querySelectorAll('button')).find(
      (current) => current.textContent === 'Enable response modification',
    );
    const select = document.querySelector<HTMLSelectElement>('#inspector-renderer')!;
    if (button === undefined) throw new Error('Missing custom inspector button');
    const observer = new MutationObserver(() => {
      if (button.isConnected) return;
      observer.disconnect();
      button.click();
      done(button.isConnected);
    });
    observer.observe(container, { childList: true, subtree: true });
    select.value = 'reference';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(connected, false);
  await waitRenderer(page, 'reference');
  await inspectOriginal(page);
  const current = await snapshot(page);
  assert.equal(current.configuration, 'Modification enabled: false');
  assert.equal(current.body, 'Response body: fixture:original');
  return { connected, configuration: current.configuration, body: current.body };
}

export const inspectorRendererChecks = [
  'the unchanged inspector uses dotted action IDs and native state-setting callbacks in the custom DOM renderer',
  "peer projection updates preserve each renderer mount's local action outcome",
  'renderer replacement disposes the old control and a fresh custom mount resets its local outcome',
  'all five shared inspector buttons remain usable without changing provider identity',
];
