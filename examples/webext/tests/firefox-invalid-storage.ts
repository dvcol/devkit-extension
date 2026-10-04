import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { styleText } from 'node:util';
import { By } from 'selenium-webdriver';
import { prepareClients, snapshot } from './firefox-idle-panels.ts';
import { closeSession, hashArtifact, startSession } from './firefox-idle-process.ts';
import {
  checkPeers,
  increase,
  openPanel,
  readProvider,
  readRecord,
  saved,
  waitText,
} from './firefox-restart-fixture.ts';

const storageKey = process.env.VITE_COUNTER_STORAGE_KEY;
assert.ok(storageKey !== undefined && storageKey !== '', 'Use the storage key from the build');
const extensionPath = resolve('dist/firefox-persistent');
const artifactHash = await hashArtifact(extensionPath);
const origin = `moz-extension://${crypto.randomUUID()}`;
const session = await startSession(new URL(origin).host);
let receipt: Awaited<ReturnType<typeof runScenario>>;
try {
  receipt = await runScenario(storageKey);
} finally {
  await closeSession(session);
}
await writeFile(
  'artifacts/persistence/firefox-invalid-storage.json',
  JSON.stringify(receipt, null, 2),
);
console.info(styleText('green', '✅ [webext/firefox-invalid-storage]'), receipt);

async function runScenario(counterStorageKey: string) {
  const { driver } = session;
  const launcher = await driver.getWindowHandle();
  assert.equal(
    await driver.installAddon(extensionPath, true),
    'devkit-native-port@example.invalid',
  );
  const previous = await prepareClients(driver, origin, counterStorageKey);
  await writeRecord(counterStorageKey, { value: 'invalid' });
  assert.deepEqual(await readRecord(driver, counterStorageKey), { value: 'invalid' });
  await reload(
    previous.documents.map((document) => document.handle),
    launcher,
  );
  const failure = await checkFailure(counterStorageKey);
  await writeRecord(counterStorageKey, { value: 7 });
  const correctedRecordBeforeReload = await readRecord(driver, counterStorageKey);
  assert.deepEqual(correctedRecordBeforeReload, { value: 7 });
  for (const document of failure.documents) {
    await driver.switchTo().window(document.handle);
    await waitText(driver, '#result', document.error);
    assert.deepEqual(await snapshot(driver), document.snapshot);
  }
  await reload(
    failure.documents.map((document) => document.handle),
    launcher,
  );
  const recovery = await checkRecovery(previous.provider, counterStorageKey);
  assert.equal(await hashArtifact(extensionPath), artifactHash);
  assert.equal((await driver.getCapabilities()).get('moz:processID'), session.processId);
  assert.equal((await driver.getSession()).getId(), session.sessionId);
  return {
    browser: session.browser,
    processId: session.processId,
    sessionId: session.sessionId,
    profile: session.profile,
    origin,
    artifactHash,
    storageKey: counterStorageKey,
    previous,
    failure,
    correctedRecordBeforeReload,
    recovery,
    ...scope(),
  };
}

function writeRecord(key: string, record: unknown): Promise<void> {
  return session.driver.executeScript(
    'return chrome.storage.local.set({ [arguments[0]]: arguments[1] })',
    key,
    record,
  );
}

async function reload(handles: readonly string[], launcher: string): Promise<void> {
  const { driver } = session;
  await driver.executeScript('chrome.runtime.reload()');
  await driver.wait(async () => {
    const current = await driver.getAllWindowHandles();
    return handles.every((handle) => !current.includes(handle));
  }, 30_000);
  await driver.switchTo().window(launcher);
}

async function checkFailure(counterStorageKey: string) {
  const { driver } = session;
  const documents = [];
  for (const index of [0, 1]) {
    await driver.switchTo().newWindow('tab');
    const handle = await driver.getWindowHandle();
    await driver.get(`${origin}/panel.html`);
    await waitText(driver, '#result', 'Stored counter must contain only an integer value');
    await waitText(driver, '#status', 'Disconnected');
    const document = await snapshot(driver);
    assert.equal(document.counterMounts, 0);
    assert.equal(document.managementMounts, 0);
    assert.deepEqual(await readRecord(driver, counterStorageKey), { value: 'invalid' });
    assert.deepEqual(await readRecord(driver, `${counterStorageKey}.independent`), { value: 44 });
    documents.push({
      handle,
      error: await driver.findElement(By.id('result')).getText(),
      snapshot: document,
    });
    await saveScreenshot(`failure-${index}`);
  }
  return { documents, savedCounter: await readRecord(driver, counterStorageKey) };
}

async function checkRecovery(
  previous: Awaited<ReturnType<typeof readProvider>>,
  counterStorageKey: string,
) {
  const { driver } = session;
  const first = await openPanel(driver, origin, 7);
  const second = await openPanel(driver, origin, 7);
  const provider = await readProvider(driver);
  assert.equal(provider.id, previous.id);
  assert.deepEqual(provider.realm, previous.realm);
  assert.notEqual(provider.incarnation, previous.incarnation);
  await driver.switchTo().window(first.handle);
  assert.deepEqual(await readProvider(driver), provider);
  await increase(driver);
  await checkPeers(driver, [first.handle, second.handle], 8);
  await saved(driver, counterStorageKey, 8);
  await driver.findElement(By.id('executions')).click();
  await waitText(driver, '#result', '{"started":0,"completed":0}');
  assert.deepEqual(await readRecord(driver, `${counterStorageKey}.independent`), { value: 44 });
  await saveScreenshot('recovery');
  return {
    documents: [first, second],
    provider,
    savedCounter: await readRecord(driver, counterStorageKey),
    snapshot: await snapshot(driver),
  };
}

async function saveScreenshot(name: string): Promise<void> {
  await mkdir('artifacts/persistence', { recursive: true });
  await writeFile(
    `artifacts/persistence/firefox-invalid-storage-${name}.png`,
    await session.driver.takeScreenshot(),
    'base64',
  );
}

function scope() {
  return {
    checks: [
      'actual malformed native storage remains unchanged while both fresh panel startups reject visibly and mount no counter or management view',
      'correcting the saved record alone leaves both failed documents disconnected with their original error and no mounts',
      'explicit native extension reload closes both failed panels before fresh callers restore the corrected counter under a new provider incarnation',
      'one explicit rendered action saves the next value in both fresh peers while the independent key is retained and execution state resets',
      'the production artifact and native process/session/profile stay unchanged until owned cleanup precedes successful receipt publication',
    ],
    limitations: [
      'Native malformed-record startup and explicit recovery after confirmed writes, not interrupted physical I/O, crash durability or permanent installation',
      'Saved-record validation and persistence belong to the example; this adds no SDK migration, retry or conflict policy',
      'Firefox WebDriver Classic does not provide global page-error capture',
    ],
  };
}
