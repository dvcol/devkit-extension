import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { styleText } from 'node:util';
import { createNativeHost } from './remote/host.ts';
import { createNativeBrowser } from './remote/browser.ts';
import { poll, send } from './remote/driver.ts';
import { agent, checkTrust, approveTarget } from './remote/authentication.ts';
import { checkRemoteContribution } from './remote/contribution.ts';
import { checkNativeDevTools } from './remote/devtools.ts';
import {
  echoResponseSchema,
  attachmentOwnershipResponseSchema,
  stopProviderResponseSchema,
  disposeClientResponseSchema,
  closePeerResponseSchema,
} from './remote/protocol.ts';

type NativeHost = Awaited<ReturnType<typeof createNativeHost>>;
type NativePage = Awaited<ReturnType<typeof createNativeBrowser>>['target'];
const checks: Array<{ name: string; details: unknown }> = [];
let pageErrors: readonly string[] = [];
let browserVersion: string | undefined;

await run();
await mkdir('artifacts', { recursive: true });
record(
  'Native DevTools opening and closing preserves CDB operations in both attachment orders',
  await checkNativeDevTools(),
);
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
  const host = await createNativeHost();
  cleanup.defer(host.close);
  const browser = await createNativeBrowser(host);
  cleanup.defer(browser.close);
  browserVersion = browser.version;
  pageErrors = browser.errors;
  const { target, control } = browser;
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
  record(
    'Remote title contribution uses its actual caller grants and retains native ownership',
    await checkRemoteContribution(host, control, target),
  );
  await checkBrowserOperation(control, host, { page: target, reference: approved.targetRef });
  await checkDisposal(control, host);
  controlDisposed = true;
  assert.deepEqual(pageErrors, []);
}

async function checkBrowserOperation(
  control: NativePage,
  host: NativeHost,
  target: { page: NativePage; reference: string },
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

async function checkDisposal(control: NativePage, host: NativeHost): Promise<void> {
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

function disposeControl(control: NativePage): Promise<void> {
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
