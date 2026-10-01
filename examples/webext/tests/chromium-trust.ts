import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { styleText } from 'node:util';
import { chromium, expect } from '@playwright/test';
import { startTimingServer } from './script-timing.ts';
import { createDeniedRequests, findTab, probeCaller, readDocument } from './trust-fixture.ts';

const profile = await mkdtemp(join(tmpdir(), 'devkit-trust-'));
const extensionPath = resolve('dist/chromium');
const browser = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
const errors: string[] = [];
browser.on('weberror', (error) => errors.push(error.error().message));
try {
  await using cleanup = new AsyncDisposableStack();
  const server = await startTimingServer();
  cleanup.defer(server.close);
  const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
  const extension = await browser.newPage();
  await extension.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`);
  await expect(extension.locator('#status')).toHaveText('Connected');
  await expect(extension.locator('#permission-status')).toHaveText('Not granted');
  const source = await browser.newPage();
  await source.goto(`${server.url}index.html`);
  const tabId = await extension.evaluate(findTab, `${server.url}index.html`);
  const messages = await createDeniedRequests();
  assert.ok(messages.length >= 2);
  assert.deepEqual(await extension.evaluate(probeCaller, { name: 'wrong-channel', messages }), []);
  assert.deepEqual(
    await extension.evaluate(probeCaller, { tabId, name: 'devkit-native-port-example', messages }),
    [],
  );
  await expect(extension.locator('#catalog')).toHaveText('active');
  await extension.locator('#routed').click();
  await expect(extension.locator('#result')).toHaveText('1');
  const document = await extension.evaluate(readDocument, { tabId, frameIds: [0] });
  assert.equal(document.runtime, 'undefined');
  await source.reload();
  await assert.rejects(
    extension.evaluate(readDocument, { tabId, documentIds: [document.documentId] }),
  );
  const replacement = await extension.evaluate(readDocument, { tabId, frameIds: [0] });
  assert.notEqual(replacement.documentId, document.documentId);
  const optionalUrl = new URL(`${server.url}index.html`);
  optionalUrl.hostname = 'localhost';
  await source.goto(optionalUrl.href);
  await assert.rejects(extension.evaluate(readDocument, { tabId, frameIds: [0] }));
  await extension.locator('#permission-remove').click();
  await expect(extension.locator('#permission-result')).toHaveText('Access removed');
  await expect(extension.locator('#permission-status')).toHaveText('Not granted');
  assert.deepEqual(errors, []);
  const receipt = {
    browser: browser.browser()?.version(),
    checks: [
      'wrong channel rejects valid native action/state requests with no replies',
      'content Port with forged packaged sender rejects valid native requests with no replies',
      'denied action does not disable service; admitted panel can still invoke it',
      'MAIN world has no extension runtime.connect',
      'stale documentId rejects after reload; explicit current-document selection succeeds',
      'optional localhost starts ungranted and native injection rejects',
    ],
    pageErrors: errors,
    limitations: [
      'Native Chrome prompt grant/refusal and post-grant revocation need a manual browser receipt.',
    ],
  };
  await mkdir('artifacts/trust', { recursive: true });
  await writeFile('artifacts/trust/chromium.json', JSON.stringify(receipt, null, 2));
  console.info(styleText('green', '✅ [trust/chromium]'), receipt);
} finally {
  await browser.close();
  await rm(profile, { recursive: true, force: true });
}
