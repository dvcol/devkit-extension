import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { connectInspector } from './inspector-browser-actions.ts';
import {
  inspectorAssets,
  inspectorProductionFixture,
  settledInspectorBuild,
} from './inspector-production-fixture.ts';

type Fixture = Awaited<ReturnType<typeof inspectorProductionFixture>>;

export async function checkInspectorProduction(
  context: BrowserContext,
  host: 'devframe' | 'devtools',
) {
  await using cleanup = new AsyncDisposableStack();
  const fixture = await inspectorProductionFixture(host);
  cleanup.defer(fixture.close);
  const initial = await settledInspectorBuild(fixture.output, 'ready');
  const assets = await inspectorAssets(fixture.origin);
  const first = await context.newPage();
  const second = await context.newPage();
  cleanup.defer(() => first.close());
  cleanup.defer(() => second.close());
  const provider = await connectInspector({ page: first, origin: fixture.origin, host });
  assert.deepEqual(
    await connectInspector({ page: second, origin: fixture.origin, host }),
    provider,
  );
  await second.locator('#inspector-renderer').selectOption('custom');
  await expect(second.locator('[data-renderer="custom"]')).toHaveCount(1);
  await action(first, 'Inspect response', 'Inspection dispatch complete');
  await body(first, 'fixture:original');
  await action(first, 'Enable response modification', 'Configuration dispatch complete');
  await action(first, 'Inspect response', 'Inspection dispatch complete');
  await body(second, 'native:fixture:original');
  const marker = await checkPreviewMarker(first, fixture, assets.html);
  const originalDocument = await first.evaluate(() => performance.timeOrigin);
  const failed = await checkFailedBuild({ first, second, fixture, initial, assets });
  const recovered = await checkRecoveredBuild({ first, second, fixture, failed, host, provider });
  assert.equal(await first.evaluate(() => performance.timeOrigin), originalDocument);
  assert.deepEqual(await inspectorAssets(assets.url), assets);
  await fixture.server.close();
  for (const page of [first, second]) {
    await expect(page.locator('#connection')).toHaveText('Disconnected. Reload to reconnect.');
    await expect(page.locator('#inspector')).toBeEmpty();
    await expect(page.locator('#inspector-renderer')).toBeDisabled();
  }
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

async function action(page: Page, label: string, outcome: string) {
  await page.locator('#inspector').getByRole('button', { name: label, exact: true }).click();
  await expect(page.locator('#inspector').getByText(outcome, { exact: true })).toBeVisible();
}

async function body(page: Page, value: string) {
  await expect(page.locator('#inspector')).toContainText(`Response body: ${value}`);
}

async function checkPreviewMarker(page: Page, fixture: Fixture, html: string) {
  await action(page, 'Install page marker', 'Marker installation failed');
  const alert = await page.locator('#inspector [role="alert"]').innerText();
  assert.match(alert, /Operation handler failed/u);
  await expect(page.locator('#inspector')).toContainText('Marker installed: false');
  const firstScript = JSON.parse(await page.locator('#marker-observation').innerText()) as unknown;
  assert.deepEqual(firstScript, { marker: null, readyState: 'loading' });
  assert.equal((await inspectorAssets(fixture.origin)).html, html);
  await action(page, 'Inspect response', 'Inspection dispatch complete');
  await body(page, 'native:fixture:original');
  /** Native errors belong to their action; a successful read does not clear a marker failure. */
  await expect(page.locator('#inspector [role="alert"]')).toHaveText(alert);
  return {
    outcome: 'Marker installation failed',
    alert,
    firstScript,
    builtHtmlUnchanged: true,
    readStillWorks: true,
  };
}

async function checkFailedBuild(options: {
  first: Page;
  second: Page;
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
  await body(first, 'fixture:original');
  await expect(first.locator('h1')).toHaveText('Portable response inspector');
  return failed;
}

async function checkRecoveredBuild(options: {
  first: Page;
  second: Page;
  fixture: Fixture;
  failed: Awaited<ReturnType<typeof settledInspectorBuild>>;
  host: 'devframe' | 'devtools';
  provider: unknown;
}) {
  const { first, second, fixture, failed, host, provider } = options;
  assert.deepEqual(
    await connectInspector({ page: second, origin: fixture.origin, host }),
    provider,
  );
  await body(second, 'fixture:original');
  await fixture.recover();
  const recovered = await settledInspectorBuild(fixture.output, 'ready', failed.attempt);
  assert.notEqual(recovered.generation, failed.generation);
  assert.deepEqual(
    await connectInspector({ page: second, origin: fixture.origin, host }),
    provider,
  );
  await expect(second.locator('h1')).toHaveText('Updated production inspector');
  await expect(first.locator('h1')).toHaveText('Portable response inspector');
  await body(second, 'fixture:original');
  await second.locator('#inspector-renderer').selectOption('custom');
  await action(second, 'Enable response modification', 'Configuration dispatch complete');
  await action(second, 'Inspect response', 'Inspection dispatch complete');
  await body(first, 'native:fixture:original');
  assert.deepEqual(JSON.parse(await first.locator('#provider').innerText()) as unknown, provider);
  return recovered;
}
