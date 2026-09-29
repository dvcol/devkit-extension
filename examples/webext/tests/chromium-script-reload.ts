import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { scriptDocument, timingRegistrations, updateTimingScript } from './script-reload.ts';
import {
  checkTimingRegistration,
  checkTimingSnapshot,
  registerTimingScript,
  startTimingServer,
  unregisterTimingScript,
} from './script-timing.ts';

export async function checkChromiumScriptReload(extension: Page, fixture: string): Promise<Page> {
  await using cleanup = new AsyncDisposableStack();
  const { url, close } = await startTimingServer();
  cleanup.defer(close);
  const source = await extension.context().newPage();
  cleanup.defer(() => source.close());
  checkTimingRegistration(await extension.evaluate(registerTimingScript, 'MAIN' as const), 'MAIN');
  await source.goto(`${url}index.html`);
  const before = await source.evaluate(scriptDocument);
  checkTimingSnapshot(before.firstScript, 'MAIN');
  assert.equal(before.revision, null);
  const replacement = await replaceExtension(extension, fixture);
  const oldDocument = await source.evaluate(scriptDocument);
  assert.deepEqual(oldDocument, before);
  assert.deepEqual(await replacement.evaluate(timingRegistrations), []);
  const freshDocuments = await checkFreshDocuments(replacement, source, `${url}index.html`);
  await writeFile(
    'artifacts/chromium-development/script-reload.json',
    JSON.stringify(
      { browser: source.context().browser()?.version(), before, oldDocument, ...freshDocuments },
      null,
      2,
    ),
  );
  return replacement;
}

async function replaceExtension(extension: Page, fixture: string): Promise<Page> {
  const url = extension.url();
  const previousProvider = await extension.locator('#provider').innerText();
  await updateTimingScript(fixture);
  await expect.poll(() => extension.isClosed(), { timeout: 30_000 }).toBe(true);
  const replacement = await extension.context().newPage();
  await replacement.goto(url);
  await expect(replacement.locator('#status')).toHaveText('Connected');
  assert.notEqual(await replacement.locator('#provider').innerText(), previousProvider);
  return replacement;
}

async function checkFreshDocuments(extension: Page, source: Page, url: string) {
  await source.goto(url);
  const unregistered = await source.evaluate(scriptDocument);
  checkTimingSnapshot(unregistered.firstScript);
  assert.equal(unregistered.revision, null);
  const registration = await extension.evaluate(registerTimingScript, 'MAIN' as const);
  try {
    checkTimingRegistration(registration, 'MAIN');
    await source.goto(url);
    const registered = await source.evaluate(scriptDocument);
    checkTimingSnapshot(registered.firstScript, 'MAIN');
    assert.equal(registered.revision, 'updated');
    return { unregistered, registered };
  } finally {
    assert.deepEqual(await extension.evaluate(unregisterTimingScript), []);
  }
}
