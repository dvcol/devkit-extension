import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { styleText } from 'node:util';
import {
  observeLifecycle,
  readLifecycle,
  readObject,
  removeObserver,
  waitForNativeIdle,
} from './firefox-idle-lifecycle.ts';
import { checkDisconnected, prepareClients, restoreClients } from './firefox-idle-panels.ts';
import { closeSession, hashArtifact, startSession } from './firefox-idle-process.ts';

const storageKey = process.env.VITE_COUNTER_STORAGE_KEY;
assert.ok(storageKey !== undefined && storageKey !== '', 'Use the storage key from the build');
const extensionPath = resolve('dist/firefox-persistent');
const artifactHash = await hashArtifact(extensionPath);
const extensionUuid = crypto.randomUUID();
const origin = `moz-extension://${extensionUuid}`;
const session = await startSession(extensionUuid);
try {
  const { driver } = session;
  const timer = await observeLifecycle(driver, 'devkit-native-port@example.invalid');
  const extensionId = await driver.installAddon(extensionPath, true);
  assert.equal(extensionId, 'devkit-native-port@example.invalid');
  const previous = await prepareClients(driver, origin, storageKey);
  console.info(styleText('cyan', '🚀 [webext/firefox-idle]'), 'Quiet native event page', {
    browser: session.browser,
    processId: session.processId,
    extensionId,
    origin,
    timer,
  });
  const idle = await waitForNativeIdle(driver);
  const disconnected = await checkDisconnected(driver, previous.documents);
  const replacement = await restoreClients(driver, origin, storageKey, previous);
  const lifecycle = await readLifecycle(driver);
  const current = readObject(lifecycle.current);
  const initial = readObject(idle.initial);
  assert.equal(current.state, 'running');
  assert.equal(current.toolboxAttached, false);
  assert.equal(current.policyActive, true);
  assert.equal(current.hasShutdown, false);
  assert.notEqual(current.contextId, initial.contextId);
  assert.equal(current.origin, `${origin}/`);
  assert.equal((await driver.getCapabilities()).get('moz:processID'), session.processId);
  assert.equal((await driver.getSession()).getId(), session.sessionId);
  assert.equal(await hashArtifact(extensionPath), artifactHash);
  await mkdir('artifacts/persistence', { recursive: true });
  await writeFile(
    'artifacts/persistence/firefox-idle.png',
    await driver.takeScreenshot(),
    'base64',
  );
  const receipt = {
    browser: session.browser,
    processId: session.processId,
    profile: session.profile,
    sessionId: session.sessionId,
    extensionId,
    origin,
    storageKey,
    artifactHash,
    timer,
    idle,
    disconnected,
    previous,
    replacement,
    lifecycle,
    ...scope(),
  };
  await writeFile('artifacts/persistence/firefox-idle.json', JSON.stringify(receipt, null, 2));
  console.info(styleText('green', '✅ [webext/firefox-idle]'), receipt);
} finally {
  try {
    await removeObserver(session.driver);
  } finally {
    await closeSession(session);
  }
}

function scope() {
  return {
    checks: [
      'native event-page suspend and stopped notifications occur at the unchanged native idle timer while two native Port clients remain quiet',
      'the stopped native background context disappears without a DevTools toolbox or extension reload',
      'old panel documents disconnect and dispose both mounted views while the Firefox process, profile and extension remain unchanged',
      'explicit fresh callers restore the confirmed saved counter under a fresh native background context and provider incarnation',
      'fresh clients mount each view once, reset ephemeral state and apply one rendered action exactly once without replaying completed work',
      'an independent native storage key stays unchanged',
    ],
    limitations: [
      'Natural idle after confirmed writes, not interrupted native I/O, browser crashes or pending RPC suspension',
      'Explicit fresh clients perform recovery; the fixture adds no automatic reconnect or replay',
      'The fixture is loaded once as a native temporary add-on; permanent installation is not exercised',
      'WebDriver Classic does not provide global page-error capture in this test',
    ],
  };
}
