import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { buildOtpAuthUrl, getTempAuthCodeInfo } from 'devframe/node/auth';

export interface InspectorPage {
  readonly page: Page;
  readonly origin: string;
  readonly host: 'devframe' | 'devtools';
}

export async function connectInspector({ page, origin, host }: InspectorPage, path = '/') {
  /** A changed OTP hash alone is same-document navigation; this proof requires a new parser run. */
  await page.goto('about:blank');
  await page.goto(buildOtpAuthUrl(new URL(path, origin).href, getTempAuthCodeInfo().code));
  await expect(page.locator('#connection')).toHaveText('Connected');
  await expect(page.locator('#inspector button')).toHaveCount(5);
  assert.equal(new URL(page.url()).hash.length, 0);
  const provider: unknown = JSON.parse(await page.locator('#provider').innerText());
  assert.partialDeepStrictEqual(provider, {
    id: `example.${host}-inspector`,
    realm: { id: 'devserver' },
  });
  return provider;
}

async function click(page: Page, label: string, outcome: string): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click();
  await expect(page.locator('#inspector').getByText(outcome, { exact: true })).toBeVisible();
}

async function snapshot(page: Page) {
  return {
    provider: JSON.parse(await page.locator('#provider').innerText()) as unknown,
    target: await page.getByText(/^Target:/u).innerText(),
    configuration: await page.getByText(/^Modification enabled:/u).innerText(),
    body: await page.getByText(/^Response body:/u).innerText(),
    marker: await page.getByText(/^Marker installed:/u).innerText(),
    firstScript: JSON.parse(await page.locator('#marker-observation').innerText()) as unknown,
  };
}

export async function inspectOriginal(page: Page): Promise<void> {
  await click(page, 'Inspect response', 'Inspection dispatch complete');
  await expect(page.locator('#inspector')).toContainText('Response body: fixture:original');
}

export async function checkInspector(primary: InspectorPage, peer: InspectorPage) {
  const { page } = primary;
  await inspectOriginal(page);
  const original = await snapshot(page);
  await click(page, 'Enable response modification', 'Configuration dispatch complete');
  await expect(page.locator('#inspector')).toContainText('Modification enabled: true');
  await expect(peer.page.locator('#inspector')).toContainText('Modification enabled: false');
  await click(page, 'Inspect response', 'Inspection dispatch complete');
  await expect(page.locator('#inspector')).toContainText('Response body: native:fixture:original');
  await inspectOriginal(peer.page);
  const modified = await snapshot(page);
  await click(page, 'Install page marker', 'Marker dispatch complete');
  await expect(page.locator('#inspector')).toContainText('Marker installed: true');
  assert.deepEqual((await snapshot(page)).firstScript, { marker: null, readyState: 'loading' });
  const reconnected = await connectInspector(primary, '/inspector-fixture');
  assert.deepEqual(reconnected, original.provider);
  await expect(page.locator('#inspector')).toContainText('Response body: native:fixture:original');
  const marked = await snapshot(page);
  assert.deepEqual(marked.firstScript, { marker: 'loading', readyState: 'loading' });
  const reset = await checkReset(primary, original.provider);
  const unaffected = await snapshot(peer.page);
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
  const { page } = primary;
  await click(page, 'Reset inspector', 'Reset dispatch complete');
  await expect(page.locator('#inspector')).toContainText('Response body: No response inspected');
  await expect(page.locator('#inspector')).toContainText('Modification enabled: false');
  await expect(page.locator('#inspector')).toContainText('Marker installed: false');
  const reset = await snapshot(page);
  assert.deepEqual(reset.firstScript, { marker: 'loading', readyState: 'loading' });
  await inspectOriginal(page);
  assert.deepEqual(await connectInspector(primary, '/inspector-fixture'), provider);
  const freshDocument = await snapshot(page);
  assert.deepEqual(freshDocument.firstScript, { marker: null, readyState: 'loading' });
  assert.equal(freshDocument.body, 'Response body: fixture:original');
  return { reset, freshDocument };
}
