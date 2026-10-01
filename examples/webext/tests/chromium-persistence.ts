import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { styleText } from 'node:util';
import { chromium, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readProvider, stopWorker } from './chromium-worker.ts';

const key = process.env.VITE_COUNTER_STORAGE_KEY;
assert.ok(key !== undefined && key !== '', 'Use the same VITE_COUNTER_STORAGE_KEY as the build');
const extensionPath = resolve('dist/chromium-persistent');
const profile = await mkdtemp(join(tmpdir(), 'native-counter-storage-'));
const browser = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
const errors: string[] = [];
browser.on('weberror', (error) => errors.push(error.error().message));
try {
  await mkdir('artifacts/persistence', { recursive: true });
  const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
  const url = `chrome-extension://${new URL(worker.url()).host}/panel.html`;
  const first = await browser.newPage();
  const second = await browser.newPage();
  await Promise.all([first.goto(url), second.goto(url)]);
  assert.equal(
    await first.evaluate(() => chrome.runtime.getManifest().permissions?.includes('storage')),
    true,
  );
  await counters([first, second], 0);
  const previous = await readProvider(first);
  assert.deepEqual(await readProvider(second), previous);
  await first.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await counters([first, second], 1);
  await expect.poll(() => readRecord(first, key)).toEqual({ value: 1 });
  await second.getByRole('button', { name: 'Native write', exact: true }).click();
  await counters([first, second], 10);
  await expect.poll(() => readRecord(first, key)).toEqual({ value: 10 });
  await first.getByRole('textbox', { name: 'Domain', exact: true }).fill('ephemeral.example.test');
  await expect(first.getByRole('textbox', { name: 'Domain', exact: true })).toHaveValue(
    'ephemeral.example.test',
  );
  const independentKey = `${key}.independent`;
  await first.evaluate(
    (storageKey) => chrome.storage.local.set({ [storageKey]: { value: 44 } }),
    independentKey,
  );
  const termination = await stopWorker(first);
  for (const page of [first, second]) {
    await expect(page.locator('#status')).toHaveText('Disconnected');
    await expect(page.locator('.devframes-json-render-scroll-root')).toHaveCount(0);
  }
  await Promise.all([first.reload(), second.reload()]);
  await counters([first, second], 10);
  const replacement = await readProvider(first);
  assert.equal(replacement.id, previous.id);
  assert.deepEqual(replacement.realm, previous.realm);
  assert.notEqual(replacement.incarnation, previous.incarnation);
  assert.deepEqual(await readProvider(second), replacement);
  await expect(first.getByRole('textbox', { name: 'Domain', exact: true })).toHaveValue(
    'shared.example.test',
  );
  for (const page of [first, second]) {
    await expect(
      page.locator('#renderer').locator('.devframes-json-render-scroll-root'),
    ).toHaveCount(1);
    await expect(
      page.locator('#management').locator('.devframes-json-render-scroll-root'),
    ).toHaveCount(1);
  }
  await first.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await counters([first, second], 11);
  await expect.poll(() => readRecord(second, key)).toEqual({ value: 11 });
  assert.deepEqual(await readRecord(second, independentKey), { value: 44 });
  await expect(
    second.getByText('Counter storage: Wrote counter 11', { exact: true }),
  ).toBeVisible();
  await first.screenshot({ path: 'artifacts/persistence/chromium.png', fullPage: true });
  const quota = await checkQuotaFailure({ first, second, storageKey: key });
  const invalid = await checkInvalidStorage(first, second, key);
  assert.deepEqual(errors, []);
  const receipt = {
    browser: browser.browser()?.version(),
    storageKey: key,
    previous,
    replacement,
    termination,
    confirmedBeforeTermination: { value: 10 },
    restored: 10,
    nextValue: 11,
    invalid,
    quota,
    checks: [
      'two native clients share action and native-state updates written to storage.local',
      'forced worker termination restores the saved counter under a fresh provider incarnation without replay',
      'restored clients have one counter and management mount, while domain UI state remains ephemeral',
      'a separate storage key remains unchanged',
      'native storage quota failure is visible without rollback or retry, and the next explicit mutation can persist',
      'invalid stored input rejects native startup without overwrite and an explicit fresh worker can recover',
    ],
    pageErrors: errors,
    limitations: [
      'Forced Chromium worker termination, not natural idle suspension or browser restart',
      'Native writes are asynchronous; action completion is not durable storage acknowledgement',
    ],
  };
  await writeFile('artifacts/persistence/chromium.json', JSON.stringify(receipt, null, 2));
  console.info(styleText('green', '✅ [webext/persistence]'), receipt);
} finally {
  await browser.close();
  await rm(profile, { recursive: true, force: true });
}

async function checkQuotaFailure(options: { first: Page; second: Page; storageKey: string }) {
  const { first, second, storageKey } = options;
  await first.evaluate((name) => chrome.storage.local.set({ [name]: { value: 9 } }), storageKey);
  await stopWorker(first);
  await Promise.all([first.reload(), second.reload()]);
  await counters([first, second], 9);
  const fillerKey = `${storageKey}.quota`;
  const bytes = await first.evaluate(async (name) => {
    await chrome.storage.local.set({ [name]: '' });
    const used = await chrome.storage.local.getBytesInUse(null);
    const quota = chrome.storage.local.QUOTA_BYTES;
    await chrome.storage.local.set({ [name]: 'a'.repeat(quota - used) });
    return { quota, used: await chrome.storage.local.getBytesInUse(null) };
  }, fillerKey);
  assert.equal(bytes.used, bytes.quota);
  await first.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await counters([first, second], 10);
  const failure = first.getByText(/^Counter storage: Write failed for counter 10:/u);
  await expect(failure).toBeVisible();
  await expect(second.getByText(/^Counter storage: Write failed for counter 10:/u)).toBeVisible();
  const message = await failure.innerText();
  assert.deepEqual(await readRecord(first, storageKey), { value: 9 });
  await first.screenshot({ path: 'artifacts/persistence/chromium-quota.png', fullPage: true });
  await first.evaluate((name) => chrome.storage.local.remove(name), fillerKey);
  assert.deepEqual(await readRecord(first, storageKey), { value: 9 });
  await first.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await counters([first, second], 11);
  await expect.poll(() => readRecord(first, storageKey)).toEqual({ value: 11 });
  await expect(
    second.getByText('Counter storage: Wrote counter 11', { exact: true }),
  ).toBeVisible();
  return { bytes, message, retained: 9, liveAfterFailure: 10, nextWrite: 11 };
}

async function counters(pages: readonly Page[], value: number): Promise<void> {
  for (const page of pages) {
    await expect(page.locator('#status')).toHaveText('Connected');
    await expect(page.getByText(`Counter: ${value}`, { exact: true })).toBeVisible();
  }
}

function readRecord(page: Page, storageKey: string): Promise<unknown> {
  return page.evaluate(
    async (name) => (await chrome.storage.local.get<Record<string, unknown>>(name))[name],
    storageKey,
  );
}

async function checkInvalidStorage(first: Page, second: Page, storageKey: string) {
  await first.evaluate(
    (name) => chrome.storage.local.set({ [name]: { value: 'invalid' } }),
    storageKey,
  );
  await stopWorker(first);
  await Promise.all([first.reload(), second.reload()]);
  for (const page of [first, second]) {
    await expect(page.locator('#status')).toHaveText('Disconnected');
    await expect(page.locator('#result')).toHaveText(
      'Stored counter must contain only an integer value',
    );
    await expect(page.locator('.devframes-json-render-scroll-root')).toHaveCount(0);
  }
  assert.deepEqual(await readRecord(first, storageKey), { value: 'invalid' });
  await first.evaluate((name) => chrome.storage.local.set({ [name]: { value: 7 } }), storageKey);
  await stopWorker(first);
  await Promise.all([first.reload(), second.reload()]);
  await counters([first, second], 7);
  return { rejected: 'invalid', explicitRecovery: 7 };
}
