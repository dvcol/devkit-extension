import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { styleText } from 'node:util';
import { chromium, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  checkInspectorOutcomes,
  checkInspectorSnapshot,
  inspectorErrorChecks,
  inspectorErrorLimitations,
  inspectorErrorSnapshot,
  isCurrentInspectorMount,
  startInspectorErrorFixture,
  startInspectorErrorSibling,
} from './inspector-error-fixture.ts';
import type { InspectorErrorFixture } from './inspector-error-fixture.ts';
import type { InspectorHost } from './inspector-hosts.ts';

const receipt = await run();
assert.deepEqual(receipt.pageErrors, []);
await mkdir('artifacts/inspector', { recursive: true });
await writeFile(
  'artifacts/inspector/errors-chromium.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.info(styleText('green', '✅ [inspector/errors/chromium]'), receipt);

async function run() {
  await using cleanup = new AsyncDisposableStack();
  const profile = await mkdtemp(join(tmpdir(), 'devkit-inspector-errors-chromium-'));
  cleanup.defer(() => rm(profile, { recursive: true, force: true }));
  const extension = resolve('dist/chromium');
  const browser = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  cleanup.defer(() => browser.close());
  const pageErrors: string[] = [];
  browser.on('weberror', (error) => pageErrors.push(error.error().message));
  const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
  const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;
  const fixture = await startInspectorErrorFixture();
  cleanup.defer(fixture.close);
  const sibling = await startInspectorErrorSibling(extensionOrigin, cleanup);
  const source = await browser.newPage();
  await source.goto(`${fixture.origin}/inspector-fixture`);
  const panel = await browser.newPage();
  await panel.goto(`${extensionOrigin}/panel.html`);
  await expect(panel.locator('#status')).toHaveText('Connected');
  await connect(panel, sibling);
  const observations = [];
  for (const renderer of ['reference', 'custom'] as const)
    observations.push(await checkRecovery({ panel, fixture, sibling, renderer }));
  return {
    browser: browser.browser()?.version(),
    mode: 'production-extension-with-native-development-sibling',
    observations,
    requests: fixture.requests(),
    pageErrors,
    checks: inspectorErrorChecks,
    limitations: [
      ...inspectorErrorLimitations,
      'Chromium configuration remains false because native response modification is unavailable',
    ],
  };
}

async function connect(panel: Page, sibling: InspectorHost) {
  await panel.locator('#server-url').fill(`${sibling.origin}/__devkit-remote/`);
  await panel.locator('#server-id').fill(sibling.provider.provider.id);
  await panel.locator('#server-token').fill(sibling.token);
  await panel.getByRole('button', { name: 'Connect server', exact: true }).click();
  await expect(panel.locator('#server-result')).toHaveText('"Connected example.devframe"');
  await panel.locator('#json-selection').selectOption('all');
}

async function action(panel: Page, label: string, outcome: string) {
  await panel.locator('#inspector').getByRole('button', { name: label, exact: true }).click();
  await expect(panel.locator('#json-result')).toContainText('"status":');
  await expect(panel.locator('#inspector')).toContainText(outcome);
  await expect(panel.locator('#inspector button:disabled')).toHaveCount(0);
  return panel.locator('#json-result').innerText();
}

async function select(panel: Page, renderer: 'reference' | 'custom') {
  await expect(panel.locator('#inspector-renderer')).toBeEnabled();
  await panel.locator('#inspector-renderer').selectOption(renderer);
  await expect(panel.locator('#inspector-renderer')).toBeEnabled();
  await expect(panel.locator('#inspector [data-renderer="custom"]')).toHaveCount(
    renderer === 'custom' ? 1 : 0,
  );
  await expect(panel.locator('#inspector').getByRole('button')).toHaveCount(5);
}

async function checkRecovery(options: {
  readonly panel: Page;
  readonly fixture: InspectorErrorFixture;
  readonly sibling: InspectorHost;
  readonly renderer: 'reference' | 'custom';
}) {
  const { panel, fixture, sibling, renderer } = options;
  const origins = { extension: fixture.origin, sibling: sibling.origin };
  await select(panel, renderer);
  await action(panel, 'Disable response modification', 'Configuration dispatch complete');
  const original = checkInspectorOutcomes(
    await action(panel, 'Inspect response', 'Inspection dispatch complete'),
    'fulfilled',
    origins,
    'fixture:original',
  );
  const before = await panel.evaluate(inspectorErrorSnapshot);
  checkInspectorSnapshot(before);
  const mount = await panel
    .locator('#inspector .devframes-json-render-scroll-root, #inspector [data-renderer="custom"]')
    .elementHandle();
  const firstRequest = fixture.requests().length;
  fixture.failure.active = true;
  const rejected = checkInspectorOutcomes(
    await action(panel, 'Inspect response', 'Inspection dispatch complete'),
    'rejected',
    origins,
    'fixture:original',
  );
  const failedRequests = fixture.requests().slice(firstRequest);
  assert.ok(
    failedRequests.length > 0 && failedRequests.every((request) => request === 'destroyed'),
  );
  const failed = await panel.evaluate(inspectorErrorSnapshot);
  checkInspectorSnapshot(failed);
  assert.deepEqual(failed, before);
  assert.equal(await mount.evaluate(isCurrentInspectorMount), true);
  fixture.failure.active = false;
  const { recovered, after } = await recover(panel, origins);
  assert.deepEqual(after, before);
  assert.equal(await mount.evaluate(isCurrentInspectorMount), true);
  await expect(panel.locator('#renderer')).toContainText('Counter: 0');
  return { renderer, original, rejected, recovered, before, failed, after, failedRequests };
}

async function recover(
  panel: Page,
  origins: { readonly extension: string; readonly sibling: string },
) {
  await action(panel, 'Reset inspector', 'Reset dispatch complete');
  await expect(panel.locator('#inspector')).toContainText('Response body: No response inspected');
  const recovered = checkInspectorOutcomes(
    await action(panel, 'Inspect response', 'Inspection dispatch complete'),
    'fulfilled',
    origins,
    'fixture:original',
  );
  const after = await panel.evaluate(inspectorErrorSnapshot);
  checkInspectorSnapshot(after);
  return { recovered, after };
}
