import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { styleText } from 'node:util';
import { By } from 'selenium-webdriver';
import { prepareClients, snapshot } from './firefox-idle-panels.ts';
import { closeSession, hashArtifact, startSession } from './firefox-idle-process.ts';
import {
  checkPeers,
  counter,
  increase,
  readCaller,
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
await mkdir('artifacts/persistence', { recursive: true });
await writeFile('artifacts/persistence/firefox-navigation.json', JSON.stringify(receipt, null, 2));
console.info(styleText('green', '✅ [webext/firefox-navigation]'), receipt);

async function runScenario(counterStorageKey: string) {
  const { driver } = session;
  assert.equal(
    await driver.installAddon(extensionPath, true),
    'devkit-native-port@example.invalid',
  );
  const previous = await prepareClients(driver, origin, counterStorageKey);
  const navigation = await leaveCaller(previous, counterStorageKey);
  const returning = await returnCaller(previous, counterStorageKey);
  assert.equal(await hashArtifact(extensionPath), artifactHash);
  assert.equal((await driver.getCapabilities()).get('moz:processID'), session.processId);
  assert.equal((await driver.getSession()).getId(), session.sessionId);
  await mkdir('artifacts/persistence', { recursive: true });
  await writeFile(
    'artifacts/persistence/firefox-navigation.png',
    await driver.takeScreenshot(),
    'base64',
  );
  return {
    browser: session.browser,
    processId: session.processId,
    sessionId: session.sessionId,
    profile: session.profile,
    origin,
    artifactHash,
    storageKey: counterStorageKey,
    previous,
    navigation,
    returning,
    ...scope(),
  };
}

async function leaveCaller(
  previous: Awaited<ReturnType<typeof prepareClients>>,
  counterStorageKey: string,
) {
  const { driver } = session;
  const [first, second] = previous.documents;
  assert.ok(first !== undefined && second !== undefined);
  await driver.findElement(By.id('wait')).click();
  await waitText(driver, '#result', 'Pending');
  await driver.switchTo().window(second.handle);
  await driver.findElement(By.id('executions')).click();
  await waitText(driver, '#result', '{"started":2,"completed":1}');
  await driver.switchTo().window(first.handle);
  await driver.get('about:blank');
  const departedDocument = await driver.executeScript<number>('return performance.timeOrigin');
  assert.notEqual(departedDocument, first.timeOrigin);
  assert.equal(await driver.getCurrentUrl(), 'about:blank');
  await driver.switchTo().window(second.handle);
  await waitText(driver, '#status', 'Connected');
  assert.deepEqual(await readProvider(driver), previous.provider);
  assert.deepEqual(await readCaller(driver, origin), previous.callers[1]);
  await increase(driver);
  await counter(driver, 11);
  await saved(driver, counterStorageKey, 11);
  await driver.findElement(By.id('release')).click();
  await driver.findElement(By.id('executions')).click();
  await waitText(driver, '#result', '{"started":2,"completed":2}');
  const surviving = await snapshot(driver);
  assert.equal(surviving.timeOrigin, second.timeOrigin);
  return {
    departedDocument,
    surviving,
    executions: await driver.findElement(By.id('result')).getText(),
  };
}

async function returnCaller(
  previous: Awaited<ReturnType<typeof prepareClients>>,
  counterStorageKey: string,
) {
  const { driver } = session;
  const [first, second] = previous.documents;
  assert.ok(first !== undefined && second !== undefined);
  await driver.switchTo().window(first.handle);
  await driver.get(`${origin}/panel.html`);
  await waitText(driver, '#status', 'Connected');
  await counter(driver, 11);
  const returning = await snapshot(driver);
  assert.notEqual(returning.timeOrigin, first.timeOrigin);
  assert.equal(returning.domain, 'shared.example.test');
  assert.equal(returning.counterMounts, 1);
  assert.equal(returning.managementMounts, 1);
  assert.deepEqual(await readProvider(driver), previous.provider);
  const caller = await readCaller(driver, origin);
  assert.notEqual(caller.id, previous.callers[0]?.id);
  assert.notEqual(caller.id, previous.callers[1]?.id);
  await increase(driver);
  await checkPeers(driver, [first.handle, second.handle], 12);
  await saved(driver, counterStorageKey, 12);
  await driver.close();
  await driver.switchTo().window(first.handle);
  await increase(driver);
  await counter(driver, 13);
  await saved(driver, counterStorageKey, 13);
  await driver.findElement(By.id('executions')).click();
  await waitText(driver, '#result', '{"started":2,"completed":2}');
  assert.deepEqual(await readRecord(driver, `${counterStorageKey}.independent`), { value: 44 });
  assert.deepEqual(await readProvider(driver), previous.provider);
  return {
    caller,
    document: returning,
    surviving: await snapshot(driver),
    savedCounter: await readRecord(driver, counterStorageKey),
  };
}

function scope() {
  return {
    checks: [
      'one production panel navigates to an actual blank document while its admitted native RPC is waiting',
      'the sibling keeps its native caller and provider identity, updates state and completes the admitted backend work after the caller document leaves',
      'returning in the same browser tab creates a fresh document and native caller with one mount per view and the current counter state',
      'returning resets local UI input without replaying the completed operation or replacing the native provider',
      'closing the sibling tab leaves the returning caller usable and an explicit rendered action saves the next counter while the independent key is retained',
      'the unchanged artifact and native process/session/profile are retained until owned cleanup precedes successful receipt publication',
    ],
    limitations: [
      'Ordinary panel navigation and closure, not back-forward cache restoration, permission revocation or background suspension',
      'The destroyed document promise cannot be inspected; completion is observed independently through the surviving native peer',
      'The waiting handler has no external side effect; navigation does not promise remote cancellation or rollback',
      'Temporary add-on installation and WebDriver Classic lack of global page-error capture retain their existing limits',
    ],
  };
}
