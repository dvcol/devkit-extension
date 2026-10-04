import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { styleText } from 'node:util';
import { By } from 'selenium-webdriver';
import {
  observeLifecycle,
  readLifecycle,
  readObject,
  removeObserver,
  waitForNativeIdle,
} from './firefox-idle-lifecycle.ts';
import { checkDisconnected, prepareClients, restoreClients } from './firefox-idle-panels.ts';
import { closeSession, hashArtifact, startSession } from './firefox-idle-process.ts';
import { waitText } from './firefox-restart-fixture.ts';

const storageKey = process.env.VITE_COUNTER_STORAGE_KEY;
assert.ok(storageKey !== undefined && storageKey !== '', 'Use the storage key from the build');
const extensionPath = resolve('dist/firefox-persistent');
const artifactHash = await hashArtifact(extensionPath);
const extensionUuid = crypto.randomUUID();
const origin = `moz-extension://${extensionUuid}`;
await mkdir('artifacts/persistence', { recursive: true });
const session = await startSession(extensionUuid);
let receipt: Awaited<ReturnType<typeof runScenario>>;
try {
  receipt = await runScenario(storageKey);
} finally {
  await cleanupSession();
}
await writeFile(
  'artifacts/persistence/firefox-pending-idle.json',
  JSON.stringify(receipt, null, 2),
);
console.info(styleText('green', '✅ [webext/firefox-pending-idle]'), receipt);

async function runScenario(counterStorageKey: string) {
  const { driver } = session;
  const timer = await observeLifecycle(driver, 'devkit-native-port@example.invalid');
  const extensionId = await driver.installAddon(extensionPath, true);
  assert.equal(extensionId, 'devkit-native-port@example.invalid');
  const previous = await prepareClients(driver, origin, counterStorageKey);
  const [first, second] = previous.documents;
  assert.ok(first !== undefined && second !== undefined);
  const pendingExecutions = await startPendingCall(first.handle, second.handle);
  console.info(styleText('cyan', '🚀 [webext/firefox-pending-idle]'), 'Native RPC is waiting', {
    browser: session.browser,
    processId: session.processId,
    pendingExecutions,
    timer,
  });
  const idle = await waitForNativeIdle(driver);
  const disconnected = await checkDisconnected(driver, previous.documents);
  await driver.switchTo().window(first.handle);
  await driver.wait(
    async () => (await driver.findElement(By.id('result')).getText()).includes('closed'),
    10_000,
  );
  const pendingResult = await driver.findElement(By.id('result')).getText();
  const replacement = await restoreClients(driver, origin, counterStorageKey, previous);
  const lifecycle = await verifyReplacementContext(idle);
  await writeFile(
    'artifacts/persistence/firefox-pending-idle.png',
    await driver.takeScreenshot(),
    'base64',
  );
  return {
    browser: session.browser,
    processId: session.processId,
    profile: session.profile,
    sessionId: session.sessionId,
    extensionId,
    origin,
    storageKey: counterStorageKey,
    artifactHash,
    timer,
    previous,
    pendingExecutions,
    pendingResult,
    idle,
    disconnected,
    replacement,
    lifecycle,
    ...scope(),
  };
}

async function startPendingCall(callerHandle: string, observerHandle: string): Promise<string> {
  const { driver } = session;
  await driver.switchTo().window(callerHandle);
  await driver.findElement(By.id('wait')).click();
  await waitText(driver, '#result', 'Pending');
  await driver.switchTo().window(observerHandle);
  await driver.findElement(By.id('executions')).click();
  await waitText(driver, '#result', '{"started":2,"completed":1}');
  return driver.findElement(By.id('result')).getText();
}

async function verifyReplacementContext(idle: Awaited<ReturnType<typeof waitForNativeIdle>>) {
  const { driver } = session;
  const lifecycle = await readLifecycle(driver);
  const current = readObject(lifecycle.current);
  const initial = readObject(idle.initial);
  assert.equal(current.state, 'running');
  assert.equal(current.toolboxAttached, false);
  assert.notEqual(current.contextId, initial.contextId);
  assert.equal((await driver.getCapabilities()).get('moz:processID'), session.processId);
  assert.equal((await driver.getSession()).getId(), session.sessionId);
  assert.equal(await hashArtifact(extensionPath), artifactHash);
  return lifecycle;
}

async function cleanupSession(): Promise<void> {
  try {
    await removeObserver(session.driver);
  } finally {
    await closeSession(session);
  }
}

function scope() {
  return {
    checks: [
      'an actual native RPC is admitted and remains pending while the two production Port panels become quiet',
      'Firefox naturally suspends the event page at its unchanged idle timer with the native RPC still waiting',
      'the old caller reports connection closure and both unchanged panel documents dispose their mounted views',
      'fresh native callers restore the confirmed saved counter under a new background context and provider incarnation',
      'ephemeral execution state resets and releasing the old work cannot replay it in the fresh background',
      'one explicit rendered action updates both fresh peers and native storage while the independent key is retained',
      'the owned Firefox process exits and its disposable profile is removed before the successful receipt is published',
    ],
    limitations: [
      'Pending native handler suspension, not interruption of physical storage I/O or browser crashes',
      'The pending probe has no external side effect; this does not promise remote cancellation or rollback',
      'Confirmed writes precede suspension and recovery requires explicit fresh clients',
      'The unchanged artifact is temporarily installed; permanent installation and automatic availability are unverified',
      'WebDriver Classic does not provide global page-error capture',
    ],
  };
}
