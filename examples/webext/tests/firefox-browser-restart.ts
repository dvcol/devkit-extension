import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { styleText } from 'node:util';
import { By } from 'selenium-webdriver';
import { Driver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';
import {
  checkPeers,
  completeDiagnosticAction,
  increase,
  openPanel,
  readCaller,
  readProvider,
  readRecord,
  saved,
  waitText,
} from './firefox-restart-fixture.ts';

const counterStorageKey = process.env.VITE_COUNTER_STORAGE_KEY;
assert.ok(
  counterStorageKey !== undefined && counterStorageKey !== '',
  'Use the storage key from the build',
);
const profile = await mkdtemp(join(tmpdir(), 'firefox-counter-restart-'));
const extensionUuid = crypto.randomUUID();
const origin = `moz-extension://${extensionUuid}`;
try {
  await mkdir('artifacts/persistence', { recursive: true });
  const previous = await beforeRestart(counterStorageKey);
  const replacement = await afterRestart(counterStorageKey, previous);
  const receipt = {
    browser: replacement.browser.version,
    storageKey: counterStorageKey,
    lifecycle: 'clean driver.quit() and a new Firefox session using the same native profile',
    installation: 'explicit native temporary add-on installation in each browser session',
    previous,
    replacement,
    checks: [
      'two Firefox clients share action and native-state changes confirmed in native storage.local',
      'the first Firefox process exits before a new session starts in the same native profile',
      'explicit temporary fixture loading retains the extension ID, UUID and confirmed saved counter',
      'fresh documents and native callers mount one counter and management view under a new provider incarnation',
      'one rendered action updates both restored clients and native storage exactly once',
      'an independent native storage key survives while diagnostic execution state resets',
    ],
    limitations: [
      'Explicit temporary fixture installation after restart, not permanent installation or automatic extension availability',
      'Clean browser shutdown after confirmed writes, not natural event-page suspension, crashes or interrupted writes',
      'Native writes remain asynchronous; action completion is not durable storage acknowledgement',
      'Firefox quota behavior and global page-error capture through WebDriver Classic are not exercised',
    ],
  };
  await writeFile(
    'artifacts/persistence/firefox-browser-restart.json',
    JSON.stringify(receipt, null, 2),
  );
  console.info(styleText('green', '✅ [webext/firefox-restart]'), receipt);
} finally {
  await rm(profile, { recursive: true, force: true });
}

async function beforeRestart(storageKey: string) {
  const session = await startSession(extensionUuid);
  const { driver } = session;
  try {
    const extensionId = await driver.installAddon(resolvePath('dist/firefox-persistent'), true);
    const first = await openPanel(driver, origin, 0);
    const provider = await readProvider(driver);
    const firstCaller = await readCaller(driver, origin);
    const second = await openPanel(driver, origin, 0);
    assert.deepEqual(await readProvider(driver), provider);
    const secondCaller = await readCaller(driver, origin);
    assert.notEqual(firstCaller.id, secondCaller.id);
    await increase(driver);
    await checkPeers(driver, [first.handle, second.handle], 1);
    await saved(driver, storageKey, 1);
    await driver.findElement(By.id('write')).click();
    await checkPeers(driver, [first.handle, second.handle], 10);
    await saved(driver, storageKey, 10);
    await driver.executeScript(
      'return chrome.storage.local.set({ [arguments[0]]: { value: 44 } })',
      `${storageKey}.independent`,
    );
    await completeDiagnosticAction(driver, first.handle, second.handle);
    return {
      browser: session.browser,
      extensionId,
      origin,
      provider,
      documents: [first, second],
      callers: [firstCaller, secondCaller],
      confirmedBeforeShutdown: await readRecord(driver, storageKey),
      executions: { started: 1, completed: 1 },
    };
  } finally {
    await closeSession(session);
  }
}

async function afterRestart(
  storageKey: string,
  previous: Awaited<ReturnType<typeof beforeRestart>>,
) {
  /** The second session reads the UUID and saved data from the existing browser profile. */
  const session = await startSession();
  const { driver } = session;
  try {
    assert.equal(session.browser.profile, previous.browser.profile);
    assert.notEqual(session.browser.processId, previous.browser.processId);
    assert.notEqual(session.browser.sessionId, previous.browser.sessionId);
    const extensionId = await driver.installAddon(resolvePath('dist/firefox-persistent'), true);
    assert.equal(extensionId, previous.extensionId);
    const clients = await restoredClients(driver, previous);
    assert.deepEqual(await readRecord(driver, storageKey), { value: 10 });
    assert.deepEqual(await readRecord(driver, `${storageKey}.independent`), { value: 44 });
    await driver.findElement(By.id('executions')).click();
    await waitText(driver, '#result', '{"started":0,"completed":0}');
    await increase(driver);
    await checkPeers(
      driver,
      clients.documents.map((document) => document.handle),
      11,
    );
    await saved(driver, storageKey, 11);
    await writeFile(
      'artifacts/persistence/firefox-browser-restart.png',
      await driver.takeScreenshot(),
      'base64',
    );
    return {
      browser: session.browser,
      extensionId,
      origin: await driver.executeScript<string>('return chrome.runtime.getURL("").slice(0, -1)'),
      ...clients,
      restored: 10,
      nextValue: await readRecord(driver, storageKey),
      independentValue: await readRecord(driver, `${storageKey}.independent`),
      executions: { started: 0, completed: 0 },
    };
  } finally {
    await closeSession(session);
  }
}

async function startSession(initialExtensionUuid?: string) {
  const options = new Options().addArguments('-headless', '-profile', profile);
  if (initialExtensionUuid !== undefined)
    options.setPreference(
      'extensions.webextensions.uuids',
      JSON.stringify({ 'devkit-native-port@example.invalid': initialExtensionUuid }),
    );
  if (process.env.FIREFOX_BINARY !== undefined) options.setBinary(process.env.FIREFOX_BINARY);
  const service = new ServiceBuilder().addArguments(
    '--allow-system-access',
    '--marionette-port',
    String(await availablePort()),
  );
  const driver = Driver.createSession(options, service.build());
  const capabilities = await driver.getCapabilities();
  const processId: unknown = capabilities.get('moz:processID');
  const actualProfile: unknown = capabilities.get('moz:profile');
  assert.ok(typeof processId === 'number' && Number.isSafeInteger(processId));
  assert.equal(actualProfile, profile);
  return {
    driver,
    browser: {
      version: capabilities.getBrowserVersion(),
      profile,
      processId,
      sessionId: (await driver.getSession()).getId(),
    },
  };
}

async function closeSession(session: Awaited<ReturnType<typeof startSession>>): Promise<void> {
  await session.driver.quit();
  /** Signal zero checks liveness without sending a termination signal. */
  assert.throws(() => process.kill(session.browser.processId, 0), { code: 'ESRCH' });
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
  return address.port;
}

async function restoredClients(
  driver: Driver,
  previous: Awaited<ReturnType<typeof beforeRestart>>,
) {
  const first = await openPanel(driver, origin, 10);
  const provider = await readProvider(driver);
  assert.equal(provider.id, previous.provider.id);
  assert.deepEqual(provider.realm, previous.provider.realm);
  assert.notEqual(provider.incarnation, previous.provider.incarnation);
  const firstCaller = await readCaller(driver, origin);
  const second = await openPanel(driver, origin, 10);
  assert.deepEqual(await readProvider(driver), provider);
  const secondCaller = await readCaller(driver, origin);
  assert.notEqual(firstCaller.id, secondCaller.id);
  for (const document of [first, second]) {
    assert.equal(
      previous.documents.some((previousDocument) => previousDocument.handle === document.handle),
      false,
    );
    assert.equal(
      previous.documents.some(
        (previousDocument) => previousDocument.timeOrigin === document.timeOrigin,
      ),
      false,
    );
  }
  return { provider, documents: [first, second], callers: [firstCaller, secondCaller] };
}
