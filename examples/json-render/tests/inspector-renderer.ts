import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Both pages must already be connected to the same genuine inspector provider. */
export async function checkInspectorRenderer(page: Page, peer: Page) {
  const provider = await page.locator('#provider').innerText();
  assert.equal(await peer.locator('#provider').innerText(), provider);
  await action(page, 'Reset inspector', 'Reset dispatch complete');
  await expect(peer.locator('#inspector')).toContainText('Response body: No response inspected');
  await selectRenderer(page, 'custom');
  await action(page, 'Inspect response', 'Inspection dispatch complete');
  await expect(page.locator('#inspector')).toContainText('Response body: fixture:original');
  await expect(peer.locator('#inspector')).toContainText('Response body: fixture:original');
  await expect(peer.locator('#inspector')).not.toContainText('Inspection dispatch complete');
  const projection = await checkProjection(page, peer);
  const detached = await checkDetachedControl(page);
  await selectRenderer(page, 'custom');
  await expect(page.locator('#inspector')).not.toContainText('Inspection dispatch complete');
  await action(page, 'Install page marker', 'Marker dispatch complete');
  await expect(page.locator('#inspector')).toContainText('Marker installed: true');
  await action(page, 'Reset inspector', 'Reset dispatch complete');
  await expect(page.locator('#inspector')).toContainText('Marker installed: false');
  await expect(page.locator('#inspector')).toContainText('Response body: No response inspected');
  assert.equal(await page.locator('#provider').innerText(), provider);
  return { provider: JSON.parse(provider) as unknown, projection, detached };
}

async function selectRenderer(page: Page, renderer: 'reference' | 'custom') {
  await page.locator('#inspector-renderer').selectOption(renderer);
  await expect(page.locator('#inspector button')).toHaveCount(5);
  await expect(page.locator('#inspector [data-renderer="custom"]')).toHaveCount(
    renderer === 'custom' ? 1 : 0,
  );
}

async function action(page: Page, label: string, outcome: string) {
  await page.locator('#inspector').getByRole('button', { name: label, exact: true }).click();
  await expect(page.locator('#inspector').getByText(outcome, { exact: true })).toBeVisible();
}

async function checkProjection(page: Page, peer: Page) {
  await action(peer, 'Enable response modification', 'Configuration dispatch complete');
  await expect(page.locator('#inspector')).toContainText('Modification enabled: true');
  /** A remote state update must not overwrite this mount's previous action callback. */
  await expect(
    page.locator('#inspector').getByText('Inspection dispatch complete', { exact: true }),
  ).toBeVisible();
  await action(page, 'Inspect response', 'Inspection dispatch complete');
  await expect(page.locator('#inspector')).toContainText('Response body: native:fixture:original');
  await expect(peer.locator('#inspector')).toContainText('Response body: native:fixture:original');
  await expect(
    peer.locator('#inspector').getByText('Configuration dispatch complete', { exact: true }),
  ).toBeVisible();
  const modified = await page.locator('#inspector').innerText();
  await action(page, 'Disable response modification', 'Configuration dispatch complete');
  await expect(page.locator('#inspector')).toContainText('Modification enabled: false');
  await action(page, 'Enable response modification', 'Configuration dispatch complete');
  await expect(peer.locator('#inspector')).toContainText('Modification enabled: true');
  await action(page, 'Disable response modification', 'Configuration dispatch complete');
  await expect(peer.locator('#inspector')).toContainText('Modification enabled: false');
  return { modified };
}

async function checkDetachedControl(page: Page) {
  const button = await page
    .locator('#inspector')
    .getByRole('button', { name: 'Enable response modification', exact: true })
    .elementHandle();
  assert.ok(button !== null);
  try {
    await selectRenderer(page, 'reference');
    assert.equal(await button.evaluate((element) => element.isConnected), false);
    /** Driver-owned reference exercises the disposed listener without exposing a page test API. */
    await button.evaluate((element) => {
      if (!(element instanceof HTMLButtonElement)) throw new Error('Expected an inspector button');
      element.click();
    });
    await action(page, 'Inspect response', 'Inspection dispatch complete');
    await expect(page.locator('#inspector')).toContainText('Modification enabled: false');
    await expect(page.locator('#inspector')).toContainText('Response body: fixture:original');
    return {
      configuration: await page
        .locator('#inspector')
        .getByText(/^Modification enabled:/u)
        .innerText(),
      body: await page
        .locator('#inspector')
        .getByText(/^Response body:/u)
        .innerText(),
    };
  } finally {
    await button.dispose();
  }
}

export const inspectorRendererChecks = [
  'the unchanged inspector uses dotted action IDs and native state-setting callbacks in the custom DOM renderer',
  "peer projection updates preserve each renderer mount's local action outcome",
  'renderer replacement disposes the old control and a fresh custom mount resets its local outcome',
  'all five shared inspector buttons remain usable without changing provider identity',
];
