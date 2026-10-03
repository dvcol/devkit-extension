import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { styleText } from 'node:util';
import { inspectorStateSchema } from '@devkit/example-contribution/inspector';
import { chromium, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  inspectorMarkerSnapshot,
  readInspectorResponse,
  startInspectorFixture,
} from './inspector-fixture.ts';
import { inspectorHostHtml, startInspectorHost } from './inspector-hosts.ts';
import type { InspectorHost } from './inspector-hosts.ts';

const servers = ['example.devframe', 'example.devtools'];
const allProviders = ['example.extension', ...servers];
const checks = [
  'one packaged native JSON inspector broadcasts the same four shared actions to extension, Devframe and DevTools providers',
  'separate native connections mount identical inspector view keys with independent state and actual owned response URLs',
  'realm-only selection modifies both servers while leaving the extension unchanged',
  'explicit provider selection resets only Devframe while preserving DevTools and extension state',
  'all-provider configure returns Chromium rejection beside both server successes; the native success callback retains broadcast semantics',
  'all-provider inspection displays original Chromium bytes and modified bytes from each server-owned endpoint',
  'all-provider marker affects each next document before its first parser script',
  'all-provider reset clears state and future marker injection without changing existing document markers',
  'one disconnected server rejects without rerouting while its sibling and the extension still inspect their own responses',
];
const limitations = [
  'The two development hosts use public createHubContext/createKitContext through createRemoteContext and public initHub on actual Vite servers; this does not test viteDevframeHub or DevTools plugin bootstrap',
  'Each native connection uses its own temporary interactive-auth token and explicitly allows the actual extension origin; no origin rewrite or additional authorization policy is installed',
  'Chromium response modification is unavailable; Firefox native modification has a separate extension proof',
  'Panel rejection messages retain native generic operation errors; the precise Chromium unsupported reason remains in projected inspector state',
  'Server transformation owns one fixture response; this does not establish arbitrary third-party HTTP interception or production preview behavior',
];

const receipt = await run();
await mkdir('artifacts/inspector', { recursive: true });
await writeFile('artifacts/inspector/mixed-chromium.json', JSON.stringify(receipt, null, 2) + '\n');
console.info(styleText('green', '✅ [inspector/mixed-chromium]'), receipt);

async function run() {
  await using cleanup = new AsyncDisposableStack();
  const profile = await mkdtemp(join(tmpdir(), 'devkit-mixed-inspector-'));
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
  const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
  const workerUrl = new URL(worker.url());
  const extensionOrigin = `${workerUrl.protocol}//${workerUrl.host}`;
  const fixture = await startInspectorFixture();
  cleanup.defer(fixture.close);
  const devframe = await createHost('devframe', extensionOrigin, cleanup);
  const devtools = await createHost('devtools', extensionOrigin, cleanup);
  const panel = await browser.newPage();
  await panel.goto(`${extensionOrigin}/panel.html`);
  await expect(panel.locator('#status')).toHaveText('Connected');
  await connect(panel, devframe);
  await connect(panel, devtools);
  const source = await browser.newPage();
  await source.goto(`${fixture.origin}/inspector-fixture`);
  const hosts = { devframe, devtools, extensionOrigin: fixture.origin };
  const selection = await checkSelection(panel, hosts);
  const partial = await checkPartialFailure(panel, hosts);
  const marker = await checkMarkerReset(panel, source, hosts);
  const disconnected = await checkDisconnect(panel, hosts);
  await expect(panel.locator('#renderer')).toContainText('Counter: 0');
  assert.deepEqual(errors, []);
  return {
    browser: browser.browser()?.version(),
    mode: 'production-extension-with-native-development-contexts',
    checks,
    observations: { selection, partial, marker, disconnected },
    pageErrors: errors,
    limitations,
  };
}

interface Hosts {
  readonly devframe: InspectorHost;
  readonly devtools: InspectorHost;
  readonly extensionOrigin: string;
}

async function createHost(
  mode: 'devframe' | 'devtools',
  extensionOrigin: string,
  cleanup: AsyncDisposableStack,
) {
  const directory = await mkdtemp(join(tmpdir(), `devkit-mixed-inspector-${mode}-`));
  cleanup.defer(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), inspectorHostHtml);
  const host = await startInspectorHost({ mode, extensionOrigin, directory });
  cleanup.defer(host.close);
  return host;
}

async function connect(panel: Page, host: InspectorHost): Promise<void> {
  await panel.locator('#server-url').fill(`${host.origin}/__devkit-remote/`);
  await panel.locator('#server-id').fill(host.provider.provider.id);
  await panel.locator('#server-token').fill(host.token);
  await panel.getByRole('button', { name: 'Connect server', exact: true }).click();
  await expect(panel.locator('#server-result')).toHaveText(
    `"Connected ${host.provider.provider.id}"`,
  );
  await expect(panel.locator('#server-token')).toHaveValue('');
  await expect(serverView(panel, host).getByRole('button')).toHaveCount(5);
}

function serverView(panel: Page, host: InspectorHost) {
  return panel.locator(`[data-provider="${host.provider.provider.id}"]`);
}

async function dispatch(panel: Page, selection: string, label: string, providers: string[]) {
  await panel.locator('#json-selection').selectOption(selection);
  await panel.locator('#inspector').getByRole('button', { name: label, exact: true }).click();
  await expect(panel.locator('#json-result')).toContainText('"status":');
  const outcomes: unknown = JSON.parse(await panel.locator('#json-result').innerText());
  assert.ok(Array.isArray(outcomes));
  assert.equal(outcomes.length, providers.length);
  for (const provider of providers) outcome(outcomes, provider);
  return outcomes as readonly unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function outcome(outcomes: readonly unknown[], provider: string) {
  const found = outcomes.find(
    (value) => isRecord(value) && isRecord(value.provider) && value.provider.id === provider,
  );
  assert.ok(isRecord(found), `Missing outcome for ${provider}`);
  return found;
}

function fulfilled(outcomes: readonly unknown[], provider: string) {
  const result = outcome(outcomes, provider);
  assert.equal(result.status, 'fulfilled');
  return inspectorStateSchema.parse(result.value);
}

function checkResponse(
  outcomes: readonly unknown[],
  provider: string,
  origin: string,
  body: string,
) {
  const state = fulfilled(outcomes, provider);
  assert.deepEqual(state.latest, { url: `${origin}/inspector-response`, status: 200, body });
  return state;
}

async function checkSelection(panel: Page, hosts: Hosts) {
  const { devframe, devtools, extensionOrigin } = hosts;
  const original = await dispatch(panel, 'all', 'Inspect response', allProviders);
  checkResponse(original, 'example.extension', extensionOrigin, 'fixture:original');
  checkResponse(original, 'example.devframe', devframe.origin, 'fixture:original');
  checkResponse(original, 'example.devtools', devtools.origin, 'fixture:original');
  const viewKeys = await panel
    .locator('#server-views [data-view]')
    .evaluateAll((elements) => elements.map((element) => element.dataset.view));
  assert.equal(viewKeys.length, 2);
  assert.equal(viewKeys[0], viewKeys[1]);
  const configured = await dispatch(panel, 'servers', 'Enable response modification', servers);
  for (const provider of servers)
    assert.equal(fulfilled(configured, provider).configuration.enabled, true);
  await expect(panel.locator('#inspector')).toContainText('Modification enabled: false');
  const inspected = await dispatch(panel, 'servers', 'Inspect response', servers);
  checkResponse(inspected, 'example.devframe', devframe.origin, 'native:fixture:original');
  checkResponse(inspected, 'example.devtools', devtools.origin, 'native:fixture:original');
  await expect(panel.locator('#inspector')).toContainText('Response body: fixture:original');
  const explicit = await dispatch(panel, 'devframe', 'Reset inspector', ['example.devframe']);
  assert.equal(fulfilled(explicit, 'example.devframe').latest, null);
  await expect(serverView(panel, devframe)).toContainText('Modification enabled: false');
  await expect(serverView(panel, devframe)).toContainText('Response body: No response inspected');
  await expect(serverView(panel, devtools)).toContainText('Modification enabled: true');
  await expect(serverView(panel, devtools)).toContainText('Response body: native:fixture:original');
  return { original, viewKeys, configured, inspected, explicit };
}

async function checkPartialFailure(panel: Page, hosts: Hosts) {
  const configured = await dispatch(panel, 'all', 'Enable response modification', allProviders);
  assert.partialDeepStrictEqual(outcome(configured, 'example.extension'), {
    status: 'rejected',
    reason: { message: 'Operation handler failed' },
  });
  for (const provider of servers)
    assert.equal(fulfilled(configured, provider).configuration.enabled, true);
  await expect(panel.locator('#inspector')).toContainText('Configuration dispatch complete');
  await expect(panel.locator('#inspector')).toContainText(
    'Native Firefox response filtering is unavailable',
  );
  await expect(panel.locator('#inspector')).toContainText('Modification enabled: false');
  const inspected = await dispatch(panel, 'all', 'Inspect response', allProviders);
  checkResponse(inspected, 'example.extension', hosts.extensionOrigin, 'fixture:original');
  checkResponse(inspected, 'example.devframe', hosts.devframe.origin, 'native:fixture:original');
  checkResponse(inspected, 'example.devtools', hosts.devtools.origin, 'native:fixture:original');
  await expect(panel.locator('#inspector')).toContainText('Response body: fixture:original');
  return { configured, inspected };
}

async function checkMarkerReset(panel: Page, source: Page, hosts: Hosts) {
  const documents = [source];
  for (const host of [hosts.devframe, hosts.devtools]) {
    const document = await panel.context().newPage();
    await document.goto(host.origin);
    documents.push(document);
  }
  for (const document of documents) {
    assert.deepEqual(await document.evaluate(inspectorMarkerSnapshot), markerSnapshot(null));
  }
  const installed = await dispatch(panel, 'all', 'Install page marker', allProviders);
  for (const provider of allProviders) assert.equal(fulfilled(installed, provider).marker, true);
  const active = await observeDocuments(documents, 'loading');
  const reset = await dispatch(panel, 'all', 'Reset inspector', allProviders);
  for (const provider of allProviders) {
    assert.partialDeepStrictEqual(fulfilled(reset, provider), {
      target: null,
      latest: null,
      configuration: { enabled: false },
      marker: false,
    });
  }
  for (const document of documents) {
    assert.deepEqual(await document.evaluate(inspectorMarkerSnapshot), markerSnapshot('loading'));
  }
  const afterReset = await observeDocuments(documents, null);
  const original = [];
  for (const document of documents) {
    const response = await document.evaluate(readInspectorResponse);
    assert.equal(response.body, 'fixture:original');
    original.push(response);
  }
  await expect(panel.locator('#inspector')).toContainText('Response body: No response inspected');
  for (const host of [hosts.devframe, hosts.devtools]) {
    await expect(serverView(panel, host)).toContainText('Response body: No response inspected');
  }
  return { installed, active, reset, afterReset, original };
}

function markerSnapshot(marker: 'loading' | null) {
  return { firstScript: { marker, readyState: 'loading' }, currentMarker: marker };
}

async function observeDocuments(documents: Page[], marker: 'loading' | null) {
  const observations = [];
  for (const document of documents) {
    await document.reload();
    const snapshot = await document.evaluate(inspectorMarkerSnapshot);
    assert.deepEqual(snapshot, markerSnapshot(marker));
    observations.push({ url: document.url(), ...snapshot });
  }
  return observations;
}

async function checkDisconnect(panel: Page, hosts: Hosts) {
  await hosts.devframe.close();
  await expect(serverView(panel, hosts.devframe)).toHaveCount(0);
  await expect(panel.locator('#providers')).toContainText('"status":"unknown"');
  const inspected = await dispatch(panel, 'all', 'Inspect response', allProviders);
  assert.equal(outcome(inspected, 'example.devframe').status, 'rejected');
  checkResponse(inspected, 'example.devtools', hosts.devtools.origin, 'fixture:original');
  checkResponse(inspected, 'example.extension', hosts.extensionOrigin, 'fixture:original');
  await expect(serverView(panel, hosts.devtools)).toContainText('Response body: fixture:original');
  await expect(panel.locator('#inspector')).toContainText('Response body: fixture:original');
  return inspected;
}
