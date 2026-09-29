import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { styleText } from 'node:util';
import { chromium } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { createNativeHost } from './remote/host.ts';
import { poll, send } from './remote/driver.ts';
import { agent, checkTrust, approveTarget } from './remote/authentication.ts';
import {
  echoResponseSchema,
  attachmentOwnershipResponseSchema,
  stopProviderResponseSchema,
  disposeClientResponseSchema,
  closePeerResponseSchema,
} from './remote/protocol.ts';

type NativeHost = Awaited<ReturnType<typeof createNativeHost>>;
const checks: Array<{ name: string; details: unknown }> = [];
const pageErrors: string[] = [];
let browserVersion: string | undefined;

await run();
await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/devframe.json',
  JSON.stringify({ browserVersion, checks, pageErrors }, null, 2) + '\n',
);
console.info(
  styleText('green', '🧪 [debugger/devframe]'),
  'Authenticated native browser operation and cleanup passed',
  browserVersion,
);

async function run() {
  await using cleanup = new AsyncDisposableStack();
  const profile = await mkdtemp(join(tmpdir(), 'devkit-cdb-browser-'));
  cleanup.defer(() => rm(profile, { recursive: true, force: true }));
  const host = await createNativeHost();
  cleanup.defer(host.close);
  const extensionPath = resolve('dist/devframe');
  const browser = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  cleanup.defer(() => browser.close());
  browserVersion = browser.browser()?.version();
  browser.on('weberror', (error) => pageErrors.push(error.error().message));
  const target = await browser.newPage();
  await target.goto(host.fixtureUrl);
  const control = await createControl(browser, host);
  let controlDisposed = false;
  cleanup.defer(async () => {
    if (!controlDisposed) await disposeControl(control);
  });
  const trust = await checkTrust(control, host);
  record(
    'Native authentication rejects missing/invalid credentials and accepts the native code',
    trust.prepared,
  );
  record('Native pairing grants no target access automatically', trust.pairing);
  const approved = await approveTarget(control, host);
  record('The actual extension control approves only the owned fixture tab', approved.approvals);
  await checkBrowserOperation(control, host, { page: target, reference: approved.targetRef });
  await checkDisposal(control, host);
  controlDisposed = true;
  assert.deepEqual(pageErrors, []);
}

async function createControl(browser: BrowserContext, host: NativeHost): Promise<Page> {
  const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
  const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;
  const registration = new URL(`${host.baseURL}__connection.json`);
  registration.searchParams.set('devframe_viewer_origin', extensionOrigin);
  registration.searchParams.set('devframe_viewer_origin_token', host.allowedOrigins.token);
  host.allowedOrigins.registerFromUrl(registration.href);
  const control = await browser.newPage();
  await control.goto(`${extensionOrigin}/control.html`);
  return control;
}

async function checkBrowserOperation(
  control: Page,
  host: NativeHost,
  target: { page: Page; reference: string },
): Promise<void> {
  const marker = 'changed-through-authenticated-native-cdb';
  const result = await host.service.broker.invoke(agent, 'browser.evaluate', {
    targetRef: target.reference,
    expression: `document.getElementById('result').textContent = '${marker}'; '${marker}'`,
  });
  assert.equal(await target.page.locator('#result').textContent(), marker);
  assert.ok(JSON.stringify(result).includes(marker));
  const ownership = await send(
    control,
    { kind: 'attachment-ownership' },
    attachmentOwnershipResponseSchema,
  );
  assert.deepEqual(ownership, { ownsAttachment: true, error: null });
  record('Host broker operation changes the real page through native RPC', { result, ownership });
  const echo = await send(
    control,
    { kind: 'echo', value: 'ordinary-during-debugging' },
    echoResponseSchema,
  );
  assert.equal(echo, 'ordinary-during-debugging');
  record('Ordinary authenticated RPC shares the peer during browser control', { echo });
}

async function checkDisposal(control: Page, host: NativeHost): Promise<void> {
  const stopped = await send(control, { kind: 'stop-provider' }, stopProviderResponseSchema);
  assert.equal(stopped.providerDisposed, true);
  assert.equal(stopped.isTrusted, true);
  assert.deepEqual(stopped.errors, []);
  const ownership = await send(
    control,
    { kind: 'attachment-ownership' },
    attachmentOwnershipResponseSchema,
  );
  assert.deepEqual(ownership, { ownsAttachment: false, error: 'native-not-attached' });
  record('Provider disposal releases this extension attachment and retains the peer', {
    ownership,
  });
  const disposed = await send(control, { kind: 'dispose-client' }, disposeClientResponseSchema);
  assert.equal(disposed.state.clientDisposed, true);
  assert.equal(disposed.state.isTrusted, true);
  assert.deepEqual(disposed.state.errors, []);
  assert.equal(disposed.echo, 'ordinary-after-cdb-client-disposal');
  record('Disposing CDB leaves ordinary native RPC usable', { echo: disposed.echo });
  const closed = await send(control, { kind: 'close-peer' }, closePeerResponseSchema);
  assert.equal(closed.closed, true);
  assert.deepEqual(closed.errors, []);
  await poll(
    () => host.sessions.size,
    (size) => size === 0,
    'actual native peer disconnect',
  );
  await host.settled();
  const snapshot = host.service.broker.snapshot();
  assert.equal(snapshot.scopes.length, 0);
  assert.equal(snapshot.leases.length, 0);
  assert.deepEqual(host.errors, []);
  record('Native peer disconnect leaves no scope or lease', {
    scopes: snapshot.scopes.length,
    leases: snapshot.leases.length,
  });
}

function disposeControl(control: Page): Promise<void> {
  const cleanup = new AsyncDisposableStack();
  cleanup.defer(async () => {
    await send(control, { kind: 'close-peer' }, closePeerResponseSchema);
  });
  cleanup.defer(async () => {
    await send(control, { kind: 'dispose-client' }, disposeClientResponseSchema);
  });
  cleanup.defer(async () => {
    await send(control, { kind: 'stop-provider' }, stopProviderResponseSchema);
  });
  return cleanup.disposeAsync();
}

function record(name: string, details: unknown): void {
  checks.push({ name, details });
}
