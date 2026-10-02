import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Context } from 'selenium-webdriver/firefox.js';
import type { Driver } from 'selenium-webdriver/firefox.js';
import {
  checkPeers,
  increase,
  openPanel,
  readCaller,
  readProvider,
  readRecord,
  saved,
} from './firefox-restart-fixture.ts';
type Panel = Awaited<ReturnType<typeof openPanel>>;
type CounterRecord = { value: number };

export const quotaFailureMessage =
  'QuotaExceededError: storage.local API call exceeded its quota limitations.';
export const maximumFillerAttempts = 256;
export const maximumAttemptedBytes = 8 * 1024 * 1024;
export type QuotaFillerBudget = {
  attempts: number;
  attemptedBytes: number;
  acceptedKeys: string[];
};
export type QuotaObservation = {
  preference: { defaultValue: number; hasUserValue: boolean; value: number };
  principal: string;
  userContextId: number;
  quota: { limit: number; usage: number };
  diagnostics: { message: string; sourceName: string }[];
  error?: string;
};
type FillerResult = { accepted: boolean; name?: string; message?: string };
/** Write bounded random filler through the actual native API; counter failures are checked separately. */
export async function fillUntilRejected(
  driver: Driver,
  storageKey: string,
  bytes: number,
  filler: QuotaFillerBudget,
) {
  let writes = 0;
  while (
    filler.attempts < maximumFillerAttempts &&
    filler.attemptedBytes + bytes <= maximumAttemptedBytes
  ) {
    const key = `${storageKey}.quota.${filler.attempts}`;
    filler.attempts += 1;
    filler.attemptedBytes += bytes;
    writes += 1;
    const result = await driver.executeScript<FillerResult>(
      `
      const randomBytes = new Uint8Array(arguments[1]);
      crypto.getRandomValues(randomBytes);
      const value = Array.from(randomBytes, byte => String.fromCharCode(33 + byte % 90)).join('');
      return chrome.storage.local.set({ [arguments[0]]: value }).then(
        () => ({ accepted: true }),
        error => ({ accepted: false, name: error.name, message: error.message })
      );
    `,
      key,
      bytes,
    );
    if (!result.accepted) return { writes, rejected: { key, ...result } };
    filler.acceptedKeys.push(key);
  }
  return { writes, safeBoundReached: true };
}

/** Query Firefox's reserved storage.local principal rather than the extension page storage principal. */
export async function readNativeQuota(
  driver: Driver,
  extensionId: string,
): Promise<QuotaObservation> {
  await driver.setContext(Context.CHROME);
  try {
    const result = await driver.executeAsyncScript<QuotaObservation>(
      `
      const extensionId = arguments[0];
      const complete = arguments[arguments.length - 1];
      const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs', { global: 'shared' });
      const { ExtensionStorageIDB } = ChromeUtils.importESModule('resource://gre/modules/ExtensionStorageIDB.sys.mjs', { global: 'shared' });
      const extension = ExtensionParent.WebExtensionPolicy.getByID(extensionId).extension;
      const principal = ExtensionStorageIDB.getStoragePrincipal(extension);
      const preferenceName = 'dom.quotaManager.temporaryStorage.fixedLimit';
      const diagnostics = Services.console.getMessageArray().map(message => ({ message: message.message, sourceName: message.sourceName ?? '' })).filter(message => /ExtensionStorageIDB|QuotaExceeded|UnknownError|IndexedDB|NS_ERROR_DOM/u.test(message.message + message.sourceName));
      const metadata = { principal: principal.origin, userContextId: principal.originAttributes.userContextId, diagnostics,
        preference: { value: Services.prefs.getIntPref(preferenceName), hasUserValue: Services.prefs.prefHasUserValue(preferenceName), defaultValue: Services.prefs.getDefaultBranch('').getIntPref(preferenceName) } };
      const request = Services.qms.estimate(principal);
      request.callback = request => {
        try {
          if (!Components.isSuccessCode(request.resultCode)) throw new Error('Native quota estimate rejected: ' + request.resultCode);
          const quota = request.result.QueryInterface(Ci.nsIQuotaEstimateResult);
          complete({ ...metadata, quota: { usage: quota.usage, limit: quota.limit } });
        } catch (error) { complete({ ...metadata, error: error.message }); }
      };
    `,
      extensionId,
    );
    assert.equal(result.error, undefined, JSON.stringify(result));
    return result;
  } finally {
    await driver.setContext(Context.CONTENT);
  }
}

export async function prepareQuotaPanels(
  driver: Driver,
  origin: string,
  storageKey: string,
): Promise<readonly [Panel, Panel]> {
  const first = await openPanel(driver, origin, 0);
  assert.equal(
    await driver.executeScript(
      'return chrome.runtime.getManifest().permissions.includes("storage")',
    ),
    true,
  );
  assert.equal(
    await driver.executeScript(
      'return chrome.runtime.getManifest().permissions.includes("unlimitedStorage")',
    ),
    false,
  );
  const second = await openPanel(driver, origin, 0);
  const panels = [first, second] as const;
  for (let value = 1; value <= 9; value++) {
    await increase(driver);
    await checkPeers(
      driver,
      panels.map((panel) => panel.handle),
      value,
    );
    await saved(driver, storageKey, value);
  }
  await driver.executeScript(
    'return chrome.storage.local.set({ [arguments[0]]: { value: 44 } })',
    `${storageKey}.independent`,
  );
  assert.deepEqual(await readCounterRecord(driver, storageKey), { value: 9 });
  await assertIndependentRecord(driver, storageKey);
  return panels;
}

export async function readPanelIdentities(
  driver: Driver,
  origin: string,
  panels: readonly [Panel, Panel],
) {
  const identities = [];
  for (const panel of panels) {
    await driver.switchTo().window(panel.handle);
    identities.push({
      handle: panel.handle,
      timeOrigin: await driver.executeScript<number>('return performance.timeOrigin'),
      caller: await readCaller(driver, origin),
      provider: await readProvider(driver),
    });
  }
  return identities;
}

export async function readCounterRecord(
  driver: Driver,
  storageKey: string,
): Promise<CounterRecord> {
  const record = await readRecord(driver, storageKey);
  assert.ok(typeof record === 'object' && record !== null && 'value' in record);
  assert.ok(typeof record.value === 'number' && Number.isSafeInteger(record.value));
  return { value: record.value };
}

export async function assertIndependentRecord(
  driver: Driver,
  storageKey: string,
): Promise<CounterRecord> {
  const independent = await readCounterRecord(driver, `${storageKey}.independent`);
  assert.deepEqual(independent, { value: 44 });
  return independent;
}

export function readQuotaManagementText(driver: Driver): Promise<string> {
  return driver.executeScript(
    'return document.querySelector("#management").shadowRoot.querySelector(".devframes-json-render-scroll-root").innerText',
  );
}

export async function takeQuotaScreenshot(
  driver: Driver,
  artifactDirectory: string,
  filename: string,
): Promise<void> {
  await driver.executeScript('document.querySelector("#management").scrollIntoView()');
  await writeFile(join(artifactDirectory, filename), await driver.takeScreenshot(), 'base64');
}

export function quotaAcceptanceScope() {
  return {
    checks: [
      'real native reduced quota rejects the rendered counter save while both live peers advance and both status views expose QuotaExceededError',
      'the previous saved counter and an independent key remain unchanged after rejected writes',
      'removing only accepted test filler keys lowers actual native estimated usage',
      'the first explicit post-removal action fails visibly while a second explicit action saves with unchanged provider and client identities',
      'public native extension reload closes old panels; fresh panels restore the confirmed counter and their next explicit action saves',
      'the owned Firefox process exits and its disposable profile is removed',
    ],
    limitations: [
      'The disposable profile explicitly reduces native temporary-storage quota to 2 MiB; default-size quotas are not measured',
      'This acceptance asserts the reproduced Firefox 157.0 sequence; native behavior in other versions may differ and is not an SDK retry policy',
      'Every counter action is explicitly clicked; no automatic retry, rollback, storage API replacement or SDK recovery mechanism is added',
      'The fixture is a native temporary add-on; permanent installation, interrupted physical I/O and browser-crash recovery are not exercised',
      'Native quota diagnostics are captured; WebDriver Classic does not provide global page-error capture here',
    ],
  };
}
