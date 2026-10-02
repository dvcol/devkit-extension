import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { styleText } from 'node:util';
import { closeSession, hashArtifact, startSession } from './firefox-idle-process.ts';
import {
  quotaAcceptanceScope,
  quotaFailureMessage,
  readQuotaManagementText,
  takeQuotaScreenshot,
  assertIndependentRecord,
  prepareQuotaPanels,
  readCounterRecord,
  readPanelIdentities,
  fillUntilRejected,
  maximumFillerAttempts,
  maximumAttemptedBytes,
  readNativeQuota,
} from './firefox-quota-fixture.ts';
import type { QuotaObservation, QuotaFillerBudget } from './firefox-quota-fixture.ts';
import { checkPeers, increase, openPanel, readProvider } from './firefox-restart-fixture.ts';

type Panel = Awaited<ReturnType<typeof openPanel>>;
type CounterRecord = { value: number };
type PressureSample = {
  bytes: number;
  filler: Awaited<ReturnType<typeof fillUntilRejected>>;
  previousSaved: CounterRecord;
  attempt: Awaited<ReturnType<typeof counterAttempt>>;
  nativeQuota: QuotaObservation;
};

const configuredStorageKey = process.env.VITE_COUNTER_STORAGE_KEY;
assert.ok(
  configuredStorageKey !== undefined && configuredStorageKey !== '',
  'Use the storage key from the build',
);
const storageKey = configuredStorageKey;
const extensionId = 'devkit-native-port@example.invalid';
const extensionPath = resolve('dist/firefox-persistent');
const artifactHash = await hashArtifact(extensionPath);
const extensionUuid = crypto.randomUUID();
const origin = `moz-extension://${extensionUuid}`;
const artifactDirectory = 'artifacts/persistence';
const filler: QuotaFillerBudget = { attempts: 0, attemptedBytes: 0, acceptedKeys: [] };
const samples: PressureSample[] = [];
const receipt: Record<string, unknown> = {
  passed: false,
  extensionId,
  origin,
  storageKey,
  artifactHash,
  samples,
  ...quotaAcceptanceScope(),
};
await mkdir(artifactDirectory, { recursive: true });
const session = await startSession(extensionUuid, {
  'dom.quotaManager.temporaryStorage.fixedLimit': 2048,
});
const { driver } = session;
let scenarioPassed = false;
Object.assign(receipt, {
  browser: session.browser,
  processId: session.processId,
  profile: session.profile,
  sessionId: session.sessionId,
});
try {
  await driver.manage().setTimeouts({ script: 15_000, pageLoad: 30_000 });
  const launcher = await driver.getWindowHandle();
  assert.equal(await driver.installAddon(extensionPath, true), extensionId);
  const panels = await prepareQuotaPanels(driver, origin, storageKey);
  const before = await readNativeQuota(driver, extensionId);
  receipt.before = before;
  assert.equal(before.preference.defaultValue, -1);
  assert.equal(before.preference.hasUserValue, true);
  assert.equal(before.preference.value, 2048);
  assert.equal(before.quota.limit, 2 * 1024 * 1024);
  assert.equal(before.userContextId, 4294967295);
  assert.equal(before.principal, `${origin}^userContextId=4294967295`);
  receipt.confirmedBefore = await readCounterRecord(driver, storageKey);
  console.info(styleText('cyan', '🚀 [webext/firefox-quota]'), 'Native reduced quota', {
    browser: session.browser,
    processId: session.processId,
    before,
  });
  const pressure = await applyPressure(panels);
  receipt.pressure = pressure;
  receipt.quotaFailureProved = true;
  await takeQuotaScreenshot(driver, artifactDirectory, 'firefox-quota-failure.png');
  const relief = await removePressure(panels, pressure);
  receipt.relief = relief;
  receipt.immediateReliefPassed = !relief.explicitNext.failed;
  const recovery = await explicitRecovery(panels, relief.explicitNext.liveValue);
  receipt.recovery = recovery;
  const replacement = await reloadPanels(panels, launcher, recovery.saved);
  receipt.replacement = replacement;
  receipt.artifactHashAfter = await hashArtifact(extensionPath);
  assert.equal(receipt.artifactHashAfter, artifactHash);
  const capabilities = await driver.getCapabilities();
  assert.equal(capabilities.get('moz:processID'), session.processId);
  assert.equal(capabilities.get('moz:profile'), session.profile);
  assert.equal((await driver.getSession()).getId(), session.sessionId);
  scenarioPassed = true;
} catch (error) {
  receipt.error =
    error instanceof Error ? { name: error.name, message: error.message } : String(error);
  throw error;
} finally {
  receipt.bounds = {
    maximumAttempts: maximumFillerAttempts,
    maximumAttemptedBytes,
    fillerAttempts: filler.attempts,
    attemptedBytes: filler.attemptedBytes,
    acceptedFillerKeys: filler.acceptedKeys.length,
    pressureCounterAttempts: samples.length,
  };
  try {
    await closeSession(session);
    receipt.processExited = true;
    await assert.rejects(access(session.profile), { code: 'ENOENT' });
    receipt.profileRemoved = true;
    receipt.passed = scenarioPassed;
  } finally {
    const filename = join(artifactDirectory, 'firefox-quota.json');
    await writeFile(filename, JSON.stringify(receipt, null, 2));
    console.info(styleText('cyan', '📋 [webext/firefox-quota]'), {
      passed: receipt.passed,
      immediateReliefPassed: receipt.immediateReliefPassed,
      receipt: filename,
    });
  }
}

async function applyPressure(panels: readonly [Panel, Panel]) {
  const identities = await readPanelIdentities(driver, origin, panels);
  for (const bytes of [32768, 8192, 2048, 512]) {
    const rejectedFiller = await fillUntilRejected(driver, storageKey, bytes, filler);
    const previousSaved = await readCounterRecord(driver, storageKey);
    const attempt = await counterAttempt(panels, 10 + samples.length);
    const sample = {
      bytes,
      filler: rejectedFiller,
      previousSaved,
      attempt,
      nativeQuota: await readNativeQuota(driver, extensionId),
    };
    samples.push(sample);
    assert.deepEqual(await readPanelIdentities(driver, origin, panels), identities);
    if (!attempt.failed) continue;
    assert.ok('rejected' in rejectedFiller);
    assert.equal(rejectedFiller.rejected.name, 'Error');
    assert.equal(rejectedFiller.rejected.message, quotaFailureMessage);
    assert.equal(
      attempt.message.split('\n').at(-1),
      `Counter storage: Write failed for counter ${attempt.liveValue}: ${quotaFailureMessage}`,
    );
    assert.deepEqual(attempt.saved, previousSaved);
    return { ...sample, identities };
  }
  throw new Error('Native counter storage did not reject within the bounded quota fixture');
}

async function removePressure(
  panels: readonly [Panel, Panel],
  pressure: Awaited<ReturnType<typeof applyPressure>>,
) {
  await driver.executeScript(
    'return chrome.storage.local.remove(arguments[0])',
    filler.acceptedKeys,
  );
  assert.deepEqual(
    await driver.executeScript(
      'return chrome.storage.local.get(arguments[0])',
      filler.acceptedKeys,
    ),
    {},
  );
  assert.deepEqual(await readCounterRecord(driver, storageKey), pressure.previousSaved);
  const afterRemoval = await readNativeQuota(driver, extensionId);
  assert.ok(afterRemoval.quota.usage < pressure.nativeQuota.quota.usage);
  const explicitNext = await counterAttempt(panels, pressure.attempt.liveValue + 1);
  assert.equal(
    explicitNext.failed,
    true,
    'The Firefox 157 baseline consumes a native Cleanup transaction',
  );
  assert.equal(
    explicitNext.message.split('\n').at(-1),
    `Counter storage: Write failed for counter ${explicitNext.liveValue}: An unexpected error occurred`,
  );
  assert.deepEqual(explicitNext.saved, pressure.previousSaved);
  const identitiesAfter = await readPanelIdentities(driver, origin, panels);
  assert.deepEqual(identitiesAfter, pressure.identities);
  const nativeObservation = await readNativeQuota(driver, extensionId);
  const newDiagnostics = nativeObservation.diagnostics.slice(afterRemoval.diagnostics.length);
  assert.ok(newDiagnostics.some((diagnostic) => diagnostic.message.includes('InvalidStateError')));
  await takeQuotaScreenshot(driver, artifactDirectory, 'firefox-quota-relief-failure.png');
  return {
    fillerRemoved: true,
    afterRemoval,
    explicitNext,
    identities: pressure.identities,
    identitiesAfter,
    nativeQuota: nativeObservation,
  };
}

async function explicitRecovery(panels: readonly [Panel, Panel], previousLiveValue: number) {
  const identities = await readPanelIdentities(driver, origin, panels);
  const explicitFollowing = await counterAttempt(panels, previousLiveValue + 1);
  assert.equal(explicitFollowing.failed, false);
  assert.deepEqual(explicitFollowing.saved, { value: previousLiveValue + 1 });
  const identitiesAfter = await readPanelIdentities(driver, origin, panels);
  assert.deepEqual(identitiesAfter, identities);
  await takeQuotaScreenshot(driver, artifactDirectory, 'firefox-quota-explicit-recovery.png');
  return {
    ...explicitFollowing,
    identities,
    identitiesAfter,
    nativeQuota: await readNativeQuota(driver, extensionId),
  };
}

async function reloadPanels(
  panels: readonly [Panel, Panel],
  launcher: string,
  confirmed: CounterRecord,
) {
  const providerBefore = await readProvider(driver);
  await driver.executeScript('chrome.runtime.reload()');
  await driver.wait(async () => {
    const handles = await driver.getAllWindowHandles();
    return panels.every((panel) => !handles.includes(panel.handle));
  }, 30_000);
  await driver.switchTo().window(launcher);
  const first = await openPanel(driver, origin, confirmed.value);
  const second = await openPanel(driver, origin, confirmed.value);
  const freshPanels = [first, second] as const;
  const providerAfter = await readProvider(driver);
  assert.notEqual(providerAfter.incarnation, providerBefore.incarnation);
  assert.equal(providerAfter.id, providerBefore.id);
  assert.deepEqual(providerAfter.realm, providerBefore.realm);
  assert.deepEqual(await readCounterRecord(driver, storageKey), confirmed);
  await assertIndependentRecord(driver, storageKey);
  const identities = await readPanelIdentities(driver, origin, freshPanels);
  const next = await counterAttempt(freshPanels, confirmed.value + 1);
  assert.equal(next.failed, false);
  assert.deepEqual(next.saved, { value: confirmed.value + 1 });
  await takeQuotaScreenshot(driver, artifactDirectory, 'firefox-quota.png');
  return {
    lifecycle: 'chrome.runtime.reload()',
    restored: confirmed,
    next,
    identities,
    providerBefore,
    providerAfter,
  };
}

async function counterAttempt(panels: readonly [Panel, Panel], value: number) {
  await driver.switchTo().window(panels[0].handle);
  await increase(driver);
  await checkPeers(
    driver,
    panels.map((panel) => panel.handle),
    value,
  );
  const messages: string[] = [];
  for (const panel of panels) {
    await driver.switchTo().window(panel.handle);
    const message = await driver.wait(async () => {
      const text = await readQuotaManagementText(driver);
      if (
        text.includes(`Write failed for counter ${value}:`) ||
        text.includes(`Wrote counter ${value}`)
      )
        return text;
      return false;
    }, 15_000);
    assert.ok(typeof message === 'string');
    messages.push(message);
  }
  const [message, peerMessage] = messages;
  assert.ok(message !== undefined && peerMessage !== undefined);
  assert.equal(peerMessage, message);
  const independent = await assertIndependentRecord(driver, storageKey);
  return {
    independent,
    liveValue: value,
    failed: message.includes(`Write failed for counter ${value}:`),
    message,
    peerMessage,
    saved: await readCounterRecord(driver, storageKey),
  };
}
