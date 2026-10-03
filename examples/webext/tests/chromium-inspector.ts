import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { styleText } from 'node:util';
import { chromium, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  inspectorChecks,
  inspectorLimitations,
  inspectorMarkerSnapshot,
  inspectorOutcome,
  readInspectorResponse,
  startInspectorFixture,
} from './inspector-fixture.ts';
import type { InspectorFixture } from './inspector-fixture.ts';

const receipt = await run();
await mkdir('artifacts/inspector', { recursive: true });
await writeFile('artifacts/inspector/chromium.json', JSON.stringify(receipt, null, 2) + '\n');
console.info(styleText('green', '✅ [inspector/chromium]'), receipt);

async function run() {
  await using cleanup = new AsyncDisposableStack();
  const profile = await mkdtemp(join(tmpdir(), 'devkit-inspector-chromium-'));
  cleanup.defer(() => rm(profile, { recursive: true, force: true }));
  const extensionPath = resolve('dist/chromium');
  const browser = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  cleanup.defer(() => browser.close());
  const errors: string[] = [];
  browser.on('weberror', (error) => errors.push(error.error().message));
  const fixture = await startInspectorFixture();
  cleanup.defer(fixture.close);
  const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
  const panel = await browser.newPage();
  await panel.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`);
  await expect(panel.locator('#status')).toHaveText('Connected');
  await expect(panel.locator('#inspector').getByRole('button')).toHaveCount(5);
  const provider = await panel.locator('#provider').innerText();
  const observations = await checkInspector(panel, fixture);
  assert.equal(await panel.locator('#provider').innerText(), provider);
  await expect(panel.locator('#renderer').getByText('Counter: 0', { exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  return {
    browser: browser.browser()?.version(),
    mode: 'production-extension',
    checks: [
      ...inspectorChecks,
      'Chromium reports response modification unavailable, rejects enabling and preserves actual response bytes',
    ],
    observations,
    pageErrors: errors,
    limitations: inspectorLimitations,
  };
}

async function dispatch(panel: Page, label: string, status: 'fulfilled' | 'rejected') {
  await panel.locator('#inspector').getByRole('button', { name: label, exact: true }).click();
  await expect(panel.locator('#json-result')).toContainText(`"status":"${status}"`);
  return inspectorOutcome(await panel.locator('#json-result').innerText(), status);
}

async function checkInspector(panel: Page, fixture: InspectorFixture) {
  const absent = await dispatch(panel, 'Inspect response', 'rejected');
  assert.equal(fixture.reads(), 0);
  const source = await panel.context().newPage();
  await source.goto(`${fixture.origin}/inspector-fixture`);
  const beforeMarker = await source.evaluate(inspectorMarkerSnapshot);
  assert.deepEqual(beforeMarker, {
    firstScript: { marker: null, readyState: 'loading' },
    currentMarker: null,
  });
  const original = await dispatch(panel, 'Inspect response', 'fulfilled');
  assert.partialDeepStrictEqual(original, [
    {
      value: {
        latest: {
          url: `${fixture.origin}/inspector-response`,
          status: 200,
          body: 'fixture:original',
        },
      },
    },
  ]);
  await expect(
    panel.locator('#inspector').getByText('Response body: fixture:original'),
  ).toBeVisible();
  const ambiguous = await checkAmbiguousTarget(panel, source, fixture);
  const unsupported = await dispatch(panel, 'Enable response modification', 'rejected');
  await expect(panel.locator('#inspector')).toContainText(
    'Native Firefox response filtering is unavailable',
  );
  await expect(panel.locator('#inspector')).toContainText('Modification enabled: false');
  const unchanged = await source.evaluate(readInspectorResponse);
  assert.equal(unchanged.body, 'fixture:original');
  await source.goto(`${fixture.origin}/other-page`);
  const otherDocument = await source.evaluate(readInspectorResponse);
  assert.equal(otherDocument.body, 'fixture:original');
  await source.goto(`${fixture.origin}/inspector-fixture`);
  const marker = await checkMarkerReset(panel, source);
  return {
    absent,
    original,
    ambiguous,
    unsupported,
    unchanged,
    otherDocument,
    beforeMarker,
    marker,
  };
}

async function checkAmbiguousTarget(panel: Page, source: Page, fixture: InspectorFixture) {
  const duplicate = await panel.context().newPage();
  try {
    await duplicate.goto(source.url());
    const reads = fixture.reads();
    const outcome = await dispatch(panel, 'Inspect response', 'rejected');
    assert.equal(fixture.reads(), reads);
    await expect(panel.locator('#inspector')).toContainText('Response body: fixture:original');
    return outcome;
  } finally {
    await duplicate.close();
  }
}

async function checkMarkerReset(panel: Page, source: Page) {
  const installed = await dispatch(panel, 'Install page marker', 'fulfilled');
  await expect(panel.locator('#inspector')).toContainText('Marker installed: true');
  await source.reload();
  const active = await source.evaluate(inspectorMarkerSnapshot);
  assert.deepEqual(active, {
    firstScript: { marker: 'loading', readyState: 'loading' },
    currentMarker: 'loading',
  });
  const reset = await dispatch(panel, 'Reset inspector', 'fulfilled');
  assert.partialDeepStrictEqual(reset, [
    {
      value: {
        target: null,
        latest: null,
        configuration: { enabled: false },
        marker: false,
      },
    },
  ]);
  assert.deepEqual(await source.evaluate(inspectorMarkerSnapshot), active);
  await expect(panel.locator('#inspector')).toContainText('Response body: No response inspected');
  await source.reload();
  const afterReset = await source.evaluate(inspectorMarkerSnapshot);
  assert.deepEqual(afterReset, {
    firstScript: { marker: null, readyState: 'loading' },
    currentMarker: null,
  });
  assert.equal((await source.evaluate(readInspectorResponse)).body, 'fixture:original');
  return { installed, active, reset, afterReset };
}
