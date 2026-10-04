import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { styleText } from 'node:util';
import { connectBrowser, readObject, readString, waitFor } from './chromium-idle-cdp.ts';
import type { BrowserConnection } from './chromium-idle-cdp.ts';
import { observeWorker, runningWorker, waitForNativeIdle } from './chromium-idle-lifecycle.ts';
import {
  checkRecoveredCounter,
  click,
  openPanel,
  prepareCounter,
  readCaller,
  readProvider,
  record,
  snapshot,
} from './chromium-idle-panel.ts';
import type { Panel } from './chromium-idle-panel.ts';
import {
  browserEndpoint,
  closeBrowser,
  hashArtifact,
  startBrowser,
} from './chromium-idle-process.ts';

const storageKey = process.env.VITE_COUNTER_STORAGE_KEY;
assert.ok(storageKey !== undefined && storageKey !== '', 'Use the storage key from the build');
const pendingCallRequested = process.argv.includes('--pending');
const scenarioName = pendingCallRequested ? 'chromium-pending-idle' : 'chromium-idle';
const extensionPath = resolve('dist/chromium-persistent');
const artifactHash = await hashArtifact(extensionPath);
const session = await startBrowser(extensionPath);
let control: BrowserConnection | undefined;
let nativeResult: Awaited<ReturnType<typeof checkNativeIdle>>;
try {
  control = await connectBrowser(await browserEndpoint(session));
  nativeResult = await checkNativeIdle(control, storageKey);
  assert.equal(
    await hashArtifact(extensionPath),
    artifactHash,
    'The existing build changed during the test',
  );
} finally {
  await closeBrowser(session, control);
}
const receipt = {
  ...nativeResult,
  executable: session.executable,
  profile: session.profile,
  processId: session.browser.pid,
  processStart: session.processStart,
  artifactHash,
};
await mkdir('artifacts/persistence', { recursive: true });
await writeFile(`artifacts/persistence/${scenarioName}.json`, JSON.stringify(receipt, null, 2));
console.info(styleText('green', `✅ [webext/${scenarioName}]`), receipt);

async function checkNativeIdle(connection: BrowserConnection, key: string) {
  const observation = await observeWorker(connection);
  const originalWorker = await runningWorker(connection);
  const location = new URL(originalWorker.url);
  const panelURL = `${location.protocol}//${location.host}/panel.html`;
  console.info(
    styleText('cyan', '🚀 [webext/chromium-idle]'),
    'Native fixture target',
    originalWorker,
  );
  const previous = await prepareClients(connection, panelURL, key);
  let pending: { executions: string; error?: string } | undefined;
  if (pendingCallRequested)
    pending = { executions: await startPendingCall(connection, previous.panels) };
  const worker = await runningWorker(connection, originalWorker.url);
  const idle = await waitForNativeIdle(connection, observation, worker);
  await checkDisconnected(connection, previous.panels, previous.documents);
  if (pending !== undefined) {
    await waitFor(
      async () => (await snapshot(connection, previous.panels[0]!)).result.includes('closed'),
      'native rejection of the waiting caller after worker loss',
    );
    pending.error = (await snapshot(connection, previous.panels[0]!)).result;
  }
  const replacement = await restoreClients(connection, panelURL, key, previous);
  const replacementWorker = await runningWorker(connection, originalWorker.url);
  assert.notEqual(replacementWorker.targetId, worker.targetId);
  assert.deepEqual(observation.attachedWorkers, []);
  assert.deepEqual(observation.failures, []);
  assert.deepEqual(observation.pageErrors, []);
  await saveScreenshot(connection, replacement.panels[0]!);
  const browserDetails = readObject(await connection.command('Browser.getVersion'));
  return {
    browser: readString(browserDetails.product),
    browserDetails,
    pageErrors: observation.pageErrors,
    storageKey: key,
    pending,
    previous: { ...previous, worker },
    replacement: { ...replacement, worker: replacementWorker },
    idle: {
      ...idle,
      versions: observation.versions.filter((version) => version.scriptURL === originalWorker.url),
      attachedWorkers: observation.attachedWorkers,
    },
    ...scope(),
  };
}

async function startPendingCall(
  connection: BrowserConnection,
  panels: readonly Panel[],
): Promise<string> {
  await click(connection, panels[0]!, '#wait');
  await waitFor(
    async () => (await snapshot(connection, panels[0]!)).result === 'Pending',
    'waiting native caller',
  );
  await click(connection, panels[1]!, '#executions');
  await waitFor(
    async () => (await snapshot(connection, panels[1]!)).result === '{"started":2,"completed":1}',
    'one admitted native RPC remains pending before natural idle',
  );
  return (await snapshot(connection, panels[1]!)).result;
}

async function prepareClients(connection: BrowserConnection, url: string, key: string) {
  const panels = [await openPanel(connection, url, 0), await openPanel(connection, url, 0)];
  const provider = await readProvider(connection, panels[0]!);
  assert.deepEqual(await readProvider(connection, panels[1]!), provider);
  const callers = await Promise.all(panels.map((panel) => readCaller(connection, panel)));
  assert.notEqual(callers[0]!.id, callers[1]!.id);
  for (const caller of callers) assert.equal(caller.url, url);
  await prepareCounter(connection, panels, key);
  const documents = await Promise.all(
    panels.map((panel) => snapshot(connection, panel).then(({ timeOrigin }) => timeOrigin)),
  );
  return {
    panels,
    provider,
    callers,
    documents,
    confirmedCounter: await record(connection, panels[0]!, key),
    independentCounter: await record(connection, panels[0]!, `${key}.independent`),
    executions: { started: 1, completed: 1 },
  };
}

async function checkDisconnected(
  connection: BrowserConnection,
  panels: readonly Panel[],
  documents: number[],
): Promise<void> {
  for (const panel of panels)
    await waitFor(async () => {
      const value = await snapshot(connection, panel);
      return (
        value.status === 'Disconnected' && value.counterMounts === 0 && value.managementMounts === 0
      );
    }, 'native Port disconnection and renderer disposal');
  const disconnected = await Promise.all(panels.map((panel) => snapshot(connection, panel)));
  assert.deepEqual(
    disconnected.map(({ timeOrigin }) => timeOrigin),
    documents,
  );
}

async function restoreClients(
  connection: BrowserConnection,
  url: string,
  key: string,
  previous: Awaited<ReturnType<typeof prepareClients>>,
) {
  const panels = [await openPanel(connection, url, 10), await openPanel(connection, url, 10)];
  const provider = await readProvider(connection, panels[0]!);
  assert.equal(provider.id, previous.provider.id);
  assert.deepEqual(provider.realm, previous.provider.realm);
  assert.notEqual(provider.incarnation, previous.provider.incarnation);
  assert.deepEqual(await readProvider(connection, panels[1]!), provider);
  const documents = await Promise.all(panels.map((panel) => snapshot(connection, panel)));
  for (const document of documents) {
    assert.equal(document.domain, 'shared.example.test');
    assert.ok(!previous.documents.includes(document.timeOrigin));
  }
  const callers = await Promise.all(panels.map((panel) => readCaller(connection, panel)));
  assert.notEqual(callers[0]!.id, callers[1]!.id);
  for (const caller of callers) assert.equal(caller.url, url);
  await checkRecoveredCounter(connection, panels, key);
  return {
    panels,
    provider,
    callers,
    documents: documents.map(({ timeOrigin }) => timeOrigin),
    restored: 10,
    savedCounter: await record(connection, panels[0]!, key),
    independentCounter: { value: 44 },
    executions: { started: 0, completed: 0 },
  };
}

/** Capture the restored panel in the foreground after the idle/recovery assertions. */
async function saveScreenshot(connection: BrowserConnection, panel: Panel): Promise<void> {
  await connection.command('Page.bringToFront', {}, panel.sessionId);
  const result = readObject(
    await connection.command('Page.captureScreenshot', {}, panel.sessionId),
  );
  await mkdir('artifacts/persistence', { recursive: true });
  await writeFile(`artifacts/persistence/${scenarioName}.png`, readString(result.data), 'base64');
}

function scope() {
  const checks = [
    'an unattached Chromium extension worker naturally disappears while two native Port clients are idle',
    'native stopped status and target destruction agree; old documents disconnect and dispose both mounted views',
    'explicit fresh callers restore confirmed counter state under a new native worker and provider incarnation',
    'fresh clients mount each view once, discard ephemeral UI/execution state and apply one rendered action exactly once',
    'an independent native storage key is preserved and completed diagnostic actions are not replayed',
  ];
  const limitations = [
    'Natural idle after confirmed writes; no interrupted native write or browser crash is exercised',
    'Explicit fresh clients perform recovery; the fixture adds no automatic reconnect or replay',
    'Page sessions observe native Runtime.exceptionThrown; no DevTools session attaches to the worker',
  ];
  if (pendingCallRequested) {
    checks.push(
      'one admitted native RPC remains pending until natural worker loss and the old caller reports connection closure',
      'ephemeral execution counts reset and releasing old work in the fresh background cannot replay the waiting operation',
      'the owned browser process exits and its disposable profile is removed before the successful receipt is published',
    );
    limitations.push(
      'The pending probe has no external side effect; no remote cancellation or rollback is promised',
    );
  } else {
    limitations.push(
      'Completed operations precede idle; pending RPC suspension has separate evidence',
    );
  }
  return {
    checks,
    limitations,
  };
}
