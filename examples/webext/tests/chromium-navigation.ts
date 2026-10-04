import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { styleText } from 'node:util';
import { connectBrowser, evaluate, readObject, readString, waitFor } from './chromium-idle-cdp.ts';
import type { BrowserConnection } from './chromium-idle-cdp.ts';
import { observeWorker, runningWorker } from './chromium-idle-lifecycle.ts';
import {
  checkClients,
  click,
  increaseCounter,
  openPanel,
  prepareCounter,
  readCaller,
  readProvider,
  record,
  saved,
  snapshot,
} from './chromium-idle-panel.ts';
import {
  browserEndpoint,
  closeBrowser,
  hashArtifact,
  startBrowser,
} from './chromium-idle-process.ts';

const storageKey = process.env.VITE_COUNTER_STORAGE_KEY;
assert.ok(storageKey !== undefined && storageKey !== '', 'Use the storage key from the build');
const extensionPath = resolve('dist/chromium-persistent');
const artifactHash = await hashArtifact(extensionPath);
const session = await startBrowser(extensionPath);
let connection: BrowserConnection | undefined;
let receipt: Awaited<ReturnType<typeof runScenario>>;
try {
  connection = await connectBrowser(await browserEndpoint(session));
  receipt = await runScenario(connection, storageKey);
} finally {
  await closeBrowser(session, connection);
}
await mkdir('artifacts/persistence', { recursive: true });
await writeFile('artifacts/persistence/chromium-navigation.json', JSON.stringify(receipt, null, 2));
console.info(styleText('green', '✅ [webext/chromium-navigation]'), receipt);

async function runScenario(control: BrowserConnection, counterStorageKey: string) {
  const observation = await observeWorker(control);
  const worker = await runningWorker(control);
  const workerLocation = new URL(worker.url);
  const panelUrl = `${workerLocation.protocol}//${workerLocation.host}/panel.html`;
  const previous = await prepareClients(control, panelUrl, counterStorageKey);
  const navigation = await leaveCaller(control, previous, counterStorageKey);
  const returning = await returnCaller(control, previous, counterStorageKey);
  assert.deepEqual(await runningWorker(control, worker.url), worker);
  assert.equal(await hashArtifact(extensionPath), artifactHash);
  assert.deepEqual(observation.pageErrors, []);
  assert.deepEqual(observation.failures, []);
  assert.deepEqual(observation.attachedWorkers, []);
  await saveScreenshot(control, previous.panels[0]!.sessionId);
  const browser = readObject(await control.command('Browser.getVersion'));
  return {
    browser: readString(browser.product),
    pageErrors: observation.pageErrors,
    workerErrors: observation.failures,
    attachedWorkers: observation.attachedWorkers,
    processId: session.browser.pid,
    profile: session.profile,
    artifactHash,
    storageKey: counterStorageKey,
    worker,
    previous,
    navigation,
    returning,
    ...scope(),
  };
}

async function prepareClients(
  control: BrowserConnection,
  panelUrl: string,
  counterStorageKey: string,
) {
  const panels = [await openPanel(control, panelUrl, 0), await openPanel(control, panelUrl, 0)];
  const provider = await readProvider(control, panels[0]!);
  assert.deepEqual(await readProvider(control, panels[1]!), provider);
  const callers = await Promise.all(panels.map((panel) => readCaller(control, panel)));
  assert.notEqual(callers[0]!.id, callers[1]!.id);
  await prepareCounter(control, panels, counterStorageKey);
  const documents = await Promise.all(panels.map((panel) => snapshot(control, panel)));
  return { panels, provider, callers, documents, panelUrl };
}

async function leaveCaller(
  control: BrowserConnection,
  previous: Awaited<ReturnType<typeof prepareClients>>,
  counterStorageKey: string,
) {
  const [first, second] = previous.panels;
  assert.ok(first !== undefined && second !== undefined);
  await click(control, first, '#wait');
  await waitFor(
    async () => (await snapshot(control, first)).result === 'Pending',
    'waiting native caller',
  );
  await click(control, second, '#executions');
  await waitFor(
    async () => (await snapshot(control, second)).result === '{"started":2,"completed":1}',
    'admitted native wait',
  );
  const navigation = readObject(
    await control.command('Page.navigate', { url: 'about:blank' }, first.sessionId),
  );
  assert.equal(navigation.errorText, undefined);
  const departed = await evaluate(
    control,
    first.sessionId,
    '({ url: location.href, timeOrigin: performance.timeOrigin })',
  );
  assert.equal(readObject(departed).url, 'about:blank');
  assert.notEqual(readObject(departed).timeOrigin, previous.documents[0]!.timeOrigin);
  await checkClients(control, [second], 10);
  assert.deepEqual(await readProvider(control, second), previous.provider);
  assert.deepEqual(await readCaller(control, second), previous.callers[1]);
  await increaseCounter(control, second);
  await checkClients(control, [second], 11);
  await saved(control, second, counterStorageKey, 11);
  await click(control, second, '#release');
  await click(control, second, '#executions');
  await waitFor(
    async () => (await snapshot(control, second)).result === '{"started":2,"completed":2}',
    'admitted work completed after navigation',
  );
  const surviving = await snapshot(control, second);
  assert.equal(surviving.timeOrigin, previous.documents[1]!.timeOrigin);
  return { departed, surviving };
}

async function returnCaller(
  control: BrowserConnection,
  previous: Awaited<ReturnType<typeof prepareClients>>,
  counterStorageKey: string,
) {
  const [first, second] = previous.panels;
  assert.ok(first !== undefined && second !== undefined);
  const navigation = readObject(
    await control.command('Page.navigate', { url: previous.panelUrl }, first.sessionId),
  );
  assert.equal(navigation.errorText, undefined);
  await checkClients(control, previous.panels, 11);
  const document = await snapshot(control, first);
  assert.notEqual(document.timeOrigin, previous.documents[0]!.timeOrigin);
  assert.equal(document.domain, 'shared.example.test');
  assert.deepEqual(await readProvider(control, first), previous.provider);
  const caller = await readCaller(control, first);
  assert.notEqual(caller.id, previous.callers[0]!.id);
  assert.notEqual(caller.id, previous.callers[1]!.id);
  await increaseCounter(control, first);
  await checkClients(control, previous.panels, 12);
  await saved(control, first, counterStorageKey, 12);
  assert.equal(
    readObject(await control.command('Target.closeTarget', { targetId: second.targetId })).success,
    true,
  );
  await increaseCounter(control, first);
  await checkClients(control, [first], 13);
  await saved(control, first, counterStorageKey, 13);
  await click(control, first, '#executions');
  await waitFor(
    async () => (await snapshot(control, first)).result === '{"started":2,"completed":2}',
    'no navigation replay',
  );
  assert.deepEqual(await readProvider(control, first), previous.provider);
  assert.deepEqual(await record(control, first, `${counterStorageKey}.independent`), { value: 44 });
  return {
    caller,
    document,
    surviving: await snapshot(control, first),
    savedCounter: await record(control, first, counterStorageKey),
  };
}

async function saveScreenshot(control: BrowserConnection, sessionId: string): Promise<void> {
  await control.command('Page.bringToFront', {}, sessionId);
  const screenshot = readObject(await control.command('Page.captureScreenshot', {}, sessionId));
  await mkdir('artifacts/persistence', { recursive: true });
  await writeFile(
    'artifacts/persistence/chromium-navigation.png',
    readString(screenshot.data),
    'base64',
  );
}

function scope() {
  return {
    checks: [
      'one production panel navigates to an actual blank document while its admitted native RPC is waiting',
      'the sibling retains its document, native caller and provider, updates state and completes admitted backend work after the caller leaves',
      'returning in the same native target creates a fresh document and caller with one mount per view and the current counter state',
      'returning resets local UI input without replaying the completed operation or replacing the native worker and provider',
      'closing the sibling target leaves the returning caller usable and an explicit rendered action saves the next counter while the independent key is retained',
      'actual page and worker errors remain empty and owned process/profile cleanup precedes successful receipt publication',
    ],
    limitations: [
      'Ordinary panel navigation and closure, not back-forward cache restoration, permission revocation or background suspension',
      'The destroyed document promise cannot be inspected; completion is observed independently through the surviving native peer',
      'The waiting handler has no external side effect; navigation does not promise remote cancellation or rollback',
      'The test captures native page exceptions but does not prove exact browser listener counts',
    ],
  };
}
