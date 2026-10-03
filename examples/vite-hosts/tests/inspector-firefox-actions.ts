import assert from 'node:assert/strict';
import { buildOtpAuthUrl, getTempAuthCodeInfo } from 'devframe/node/auth';
import { By } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';

export interface InspectorPage {
  readonly driver: Driver;
  readonly window: string;
  readonly origin: string;
  readonly host: 'devframe' | 'devtools';
}

/** Read visible native renderer failures; WebDriver Classic does not capture global page errors. */
export async function snapshot({ driver, window }: InspectorPage) {
  await driver.switchTo().window(window);
  const current = await driver.executeScript<{
    text: string;
    connection: string;
    provider: string;
    firstScript: string;
    buttons: number;
    customViews: number;
    alert: string;
    overlay: string;
  }>(() => {
    const mount = document.querySelector('#inspector')!.firstElementChild;
    const root = mount?.shadowRoot ?? mount;
    function text(selector: string): string {
      return root?.querySelector<HTMLElement>(selector)?.innerText ?? '';
    }
    return {
      text: text('.devframes-json-render-scroll-root, [data-renderer="custom"]'),
      connection: document.querySelector('#connection')!.textContent ?? '',
      provider: document.querySelector('#provider')!.textContent ?? '',
      firstScript: document.querySelector('#marker-observation')!.textContent ?? '',
      buttons: root?.querySelectorAll('button').length ?? 0,
      customViews: root?.querySelectorAll('[data-renderer="custom"]').length ?? 0,
      alert: text('[role="alert"]'),
      overlay: document.querySelector('vite-error-overlay')?.shadowRoot?.textContent ?? '',
    };
  });
  assert.equal(current.alert, '');
  assert.equal(current.overlay, '');
  assert.doesNotMatch(current.connection, /Connection failed|Renderer failed|Disconnected/u);
  const lines = current.text.split('\n');
  return {
    ...current,
    provider: JSON.parse(current.provider === '' ? 'null' : current.provider) as unknown,
    firstScript: JSON.parse(current.firstScript === '' ? 'null' : current.firstScript) as unknown,
    target: lines.find((line) => line.startsWith('Target:')),
    configuration: lines.find((line) => line.startsWith('Modification enabled:')),
    body: lines.find((line) => line.startsWith('Response body:')),
    marker: lines.find((line) => line.startsWith('Marker installed:')),
  };
}

export async function waitText(page: InspectorPage, text: string): Promise<void> {
  await page.driver.wait(async () => (await snapshot(page)).text.includes(text), 10_000);
}

export async function connectInspector(page: InspectorPage, path = '/') {
  const { driver, window, origin, host } = page;
  await driver.switchTo().window(window);
  /** A changed OTP hash alone is same-document navigation; this proof needs a new parser run. */
  await driver.get('about:blank');
  await driver.get(buildOtpAuthUrl(new URL(path, origin).href, getTempAuthCodeInfo().code));
  await driver.wait(async () => (await snapshot(page)).connection === 'Connected', 10_000);
  const current = await snapshot(page);
  assert.equal(current.buttons, 5);
  assert.equal(new URL(await driver.getCurrentUrl()).hash.length, 0);
  assert.partialDeepStrictEqual(current.provider, {
    id: `example.${host}-inspector`,
    realm: { id: 'devserver' },
  });
  return current.provider;
}

export async function click(page: InspectorPage, label: string, outcome: string): Promise<void> {
  const { driver, window } = page;
  await driver.switchTo().window(window);
  const mount = await driver.findElement(By.css('#inspector > div'));
  const root = (await snapshot(page)).customViews === 1 ? mount : await mount.getShadowRoot();
  const buttons = await root.findElements(By.css('button'));
  const labels = await Promise.all(buttons.map((button) => button.getText()));
  const button = buttons[labels.indexOf(label)];
  assert.ok(button, `Missing native action button: ${label}`);
  await driver.wait(() => button.isEnabled(), 10_000);
  await button.click();
  await waitText(page, outcome);
}

export async function inspectOriginal(page: InspectorPage): Promise<void> {
  await click(page, 'Inspect response', 'Inspection dispatch complete');
  await waitText(page, 'Response body: fixture:original');
}

export async function checkInspector(primary: InspectorPage, peer: InspectorPage) {
  await inspectOriginal(primary);
  const original = await snapshot(primary);
  await click(primary, 'Enable response modification', 'Configuration dispatch complete');
  await waitText(primary, 'Modification enabled: true');
  assert.equal((await snapshot(peer)).configuration, 'Modification enabled: false');
  await click(primary, 'Inspect response', 'Inspection dispatch complete');
  await waitText(primary, 'Response body: native:fixture:original');
  await inspectOriginal(peer);
  const modified = await snapshot(primary);
  await click(primary, 'Install page marker', 'Marker dispatch complete');
  await waitText(primary, 'Marker installed: true');
  assert.deepEqual((await snapshot(primary)).firstScript, { marker: null, readyState: 'loading' });
  assert.deepEqual(await connectInspector(primary, '/inspector-fixture'), original.provider);
  await waitText(primary, 'Response body: native:fixture:original');
  const marked = await snapshot(primary);
  assert.deepEqual(marked.firstScript, { marker: 'loading', readyState: 'loading' });
  const reset = await checkReset(primary, original.provider);
  const unaffected = await snapshot(peer);
  assert.equal(unaffected.configuration, 'Modification enabled: false');
  assert.equal(unaffected.body, 'Response body: fixture:original');
  assert.deepEqual(unaffected.firstScript, { marker: null, readyState: 'loading' });
  return {
    host: primary.host,
    origin: primary.origin,
    original,
    modified,
    marked,
    reset,
    unaffected,
  };
}

async function checkReset(primary: InspectorPage, provider: unknown) {
  await click(primary, 'Reset inspector', 'Reset dispatch complete');
  await waitText(primary, 'Response body: No response inspected');
  const reset = await snapshot(primary);
  assert.equal(reset.configuration, 'Modification enabled: false');
  assert.equal(reset.marker, 'Marker installed: false');
  assert.deepEqual(reset.firstScript, { marker: 'loading', readyState: 'loading' });
  await inspectOriginal(primary);
  assert.deepEqual(await connectInspector(primary, '/inspector-fixture'), provider);
  const freshDocument = await snapshot(primary);
  assert.deepEqual(freshDocument.firstScript, { marker: null, readyState: 'loading' });
  assert.equal(freshDocument.body, 'Response body: fixture:original');
  return { reset, freshDocument };
}
