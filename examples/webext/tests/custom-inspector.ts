import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { styleText } from 'node:util';
import { inspectorStateSchema, readInspectorAction } from '@devkit/example-contribution/inspector';
import { chromium, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { inspectorMarkerSnapshot, startInspectorFixture } from './inspector-fixture.ts';
import { inspectorHostHtml, startInspectorHost } from './inspector-hosts.ts';
import type { InspectorHost } from './inspector-hosts.ts';

const receipt = await run();
await mkdir('artifacts/inspector', { recursive: true });
await writeFile(
  'artifacts/inspector/custom-chromium.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.info(styleText('green', '✅ [inspector/custom-chromium]'), receipt);

async function run() {
  await using cleanup = new AsyncDisposableStack();
  const profile = await mkdtemp(join(tmpdir(), 'devkit-custom-inspector-'));
  cleanup.defer(() => rm(profile, { recursive: true, force: true }));
  const extension = resolve('dist/chromium');
  const browser = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  cleanup.defer(() => browser.close());
  const errors: string[] = [];
  browser.on('weberror', (error) => errors.push(error.error().message));
  const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
  const url = new URL(worker.url());
  const extensionOrigin = `${url.protocol}//${url.host}`;
  const fixture = await startInspectorFixture();
  cleanup.defer(fixture.close);
  const source = await browser.newPage();
  await source.goto(`${fixture.origin}/inspector-fixture`);
  const hosts = [];
  for (const mode of ['devframe', 'devtools'] as const)
    hosts.push(await createHost(mode, extensionOrigin, cleanup));
  const panel = await browser.newPage();
  await panel.goto(`${extensionOrigin}/panel.html`);
  await expect(panel.locator('#status')).toHaveText('Connected');
  for (const host of hosts) await connect(panel, host);
  const provider = await panel.locator('#provider').innerText();
  await select(panel, 'custom');
  const selection = await checkSelection(panel, hosts, fixture.origin);
  const replacement = await checkReplacement(panel, hosts);
  const marker = await checkMarker(panel, source);
  const disconnected = await checkDisconnect(panel, hosts);
  assert.equal(await panel.locator('#provider').innerText(), provider);
  assert.deepEqual(errors, []);
  return {
    browser: browser.browser()?.version(),
    mode: 'production-extension-custom-renderer',
    checks: customChecks(),
    observations: { selection, replacement, marker, disconnected },
    pageErrors: errors,
    limitations: [
      'Native development contexts use initHub on owned Vite fixtures, not plugin bootstrap',
      'Chromium response modification remains explicitly unavailable; server cards use the native reference renderer',
    ],
  };
}

async function createHost(
  mode: 'devframe' | 'devtools',
  extensionOrigin: string,
  cleanup: AsyncDisposableStack,
) {
  const directory = await mkdtemp(join(tmpdir(), `devkit-custom-inspector-${mode}-`));
  cleanup.defer(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), inspectorHostHtml);
  const host = await startInspectorHost({ mode, extensionOrigin, directory });
  cleanup.defer(host.close);
  return host;
}

async function connect(panel: Page, host: InspectorHost) {
  await panel.locator('#server-url').fill(`${host.origin}/__devkit-remote/`);
  await panel.locator('#server-id').fill(host.provider.provider.id);
  await panel.locator('#server-token').fill(host.token);
  await panel.getByRole('button', { name: 'Connect server', exact: true }).click();
  await expect(panel.locator('#server-result')).toHaveText(
    `"Connected ${host.provider.provider.id}"`,
  );
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

async function dispatch(panel: Page, selection: string, label: string, count: number) {
  await panel.locator('#json-selection').selectOption(selection);
  await panel.locator('#inspector').getByRole('button', { name: label, exact: true }).click();
  await expect(panel.locator('#json-result')).toContainText('"status":');
  const outcomes: unknown = JSON.parse(await panel.locator('#json-result').innerText());
  assert.ok(Array.isArray(outcomes));
  assert.equal(outcomes.length, count);
  return outcomes as readonly unknown[];
}

function outcome(values: readonly unknown[], provider: string) {
  const found = values.find(
    (value) => isRecord(value) && isRecord(value.provider) && value.provider.id === provider,
  );
  assert.ok(isRecord(found));
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function state(values: readonly unknown[], provider: string) {
  const selected = outcome(values, provider);
  assert.equal(selected.status, 'fulfilled');
  return inspectorStateSchema.parse(selected.value);
}

async function checkSelection(panel: Page, hosts: InspectorHost[], extensionOrigin: string) {
  const configured = await dispatch(panel, 'servers', 'Enable response modification', 2);
  for (const host of hosts)
    assert.equal(state(configured, host.provider.provider.id).configuration.enabled, true);
  await expect(panel.locator('#inspector')).toContainText('Modification enabled: false');
  const explicit = await dispatch(panel, 'devframe', 'Reset inspector', 1);
  assert.equal(state(explicit, 'example.devframe').configuration.enabled, false);
  await expect(panel.locator('[data-provider="example.devtools"]')).toContainText(
    'Modification enabled: true',
  );
  const all = await dispatch(panel, 'all', 'Enable response modification', 3);
  assert.partialDeepStrictEqual(outcome(all, 'example.extension'), {
    status: 'rejected',
    reason: { message: 'Operation handler failed' },
  });
  await expect(panel.locator('#inspector')).toContainText('Configuration dispatch complete');
  const inspected = await dispatch(panel, 'all', 'Inspect response', 3);
  assert.deepEqual(state(inspected, 'example.extension').latest, {
    url: `${extensionOrigin}/inspector-response`,
    status: 200,
    body: 'fixture:original',
  });
  for (const host of hosts) {
    assert.deepEqual(state(inspected, host.provider.provider.id).latest, {
      url: `${host.origin}/inspector-response`,
      status: 200,
      body: 'native:fixture:original',
    });
    await expect(panel.locator(`[data-provider="${host.provider.provider.id}"]`)).toContainText(
      'Response body: native:fixture:original',
    );
  }
  await expect(panel.locator('#inspector')).toContainText('Inspection dispatch complete');
  return { configured, explicit, all, inspected };
}

async function checkReplacement(panel: Page, hosts: InspectorHost[]) {
  const detached = await panel
    .locator('#inspector')
    .getByRole('button', { name: 'Reset inspector', exact: true })
    .elementHandle();
  await select(panel, 'reference');
  assert.equal(await detached.evaluate((button) => button.isConnected), false);
  const before = await panel.locator('#json-result').innerText();
  await detached.evaluate((button) =>
    button.dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );
  assert.equal(await panel.locator('#json-result').innerText(), before);
  const preserved = await dispatch(panel, 'all', 'Inspect response', 3);
  for (const host of hosts)
    assert.equal(state(preserved, host.provider.provider.id).configuration.enabled, true);
  await select(panel, 'custom');
  await expect(panel.locator('#inspector')).toContainText('Response body: fixture:original');
  await expect(panel.locator('#inspector')).not.toContainText('Inspection dispatch complete');
  return { preserved, detachedConnected: await detached.evaluate((button) => button.isConnected) };
}

async function checkMarker(panel: Page, source: Page) {
  const installed = await dispatch(panel, 'all', 'Install page marker', 3);
  for (const provider of ['example.extension', 'example.devframe', 'example.devtools'])
    assert.equal(state(installed, provider).marker, true);
  await source.reload();
  const active = await source.evaluate(inspectorMarkerSnapshot);
  assert.deepEqual(active, {
    firstScript: { marker: 'loading', readyState: 'loading' },
    currentMarker: 'loading',
  });
  const reset = await dispatch(panel, 'all', 'Reset inspector', 3);
  for (const provider of ['example.extension', 'example.devframe', 'example.devtools']) {
    assert.partialDeepStrictEqual(state(reset, provider), {
      latest: null,
      configuration: { enabled: false },
      marker: false,
    });
  }
  await expect(panel.locator('#inspector')).toContainText('Reset dispatch complete');
  await source.reload();
  const afterReset = await source.evaluate(inspectorMarkerSnapshot);
  assert.deepEqual(afterReset, {
    firstScript: { marker: null, readyState: 'loading' },
    currentMarker: null,
  });
  return { installed, active, reset, afterReset };
}

async function checkDisconnect(panel: Page, hosts: InspectorHost[]) {
  const detached = await panel
    .locator('#inspector')
    .getByRole('button', { name: 'Enable response modification', exact: true })
    .elementHandle();
  await panel.locator('#disconnect').click();
  await expect(panel.locator('#status')).toHaveText('Disconnected');
  await expect(panel.locator('#inspector-renderer')).toBeDisabled();
  await expect(panel.locator('#inspector').getByRole('button')).toHaveCount(0);
  await expect(panel.locator('#server-views')).toBeEmpty();
  assert.equal(await detached.evaluate((button) => button.isConnected), false);
  await detached.evaluate((button) =>
    button.dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );
  const states = [];
  for (const host of hosts) {
    const current = await host.provider.invoke({ action: readInspectorAction, input: {} });
    assert.equal(current.configuration.enabled, false);
    states.push({ provider: host.provider.provider.id, state: current });
  }
  return { states, detachedConnected: await detached.evaluate((button) => button.isConnected) };
}

function customChecks() {
  return [
    'packaged framework-free renderer mounts the unchanged shared inspector and dispatches all four actions through existing native bindings',
    'custom-rendered actions preserve realm-only, explicit provider and all-provider broadcast selection with independent native state',
    'Chromium configure rejection remains beside server successes and the native success callback displays broadcast completion',
    'custom inspection shows actual owned response bytes while native reference server cards update independently',
    'reference/custom replacement preserves backend state and detached custom reset buttons cannot dispatch',
    'custom marker and reset actions affect the next actual owned document and clear projected state',
    'disconnect disposes the custom mount, disables selection and prevents retained buttons from changing server state',
  ];
}
