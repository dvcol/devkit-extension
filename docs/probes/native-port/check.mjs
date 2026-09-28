import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const extensionPath = resolve('dist');
const profile = await mkdtemp(join(tmpdir(), 'native-port-chromium-'));
const browser = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
const errors = [];
browser.on('console', (message) => console.log('browser console', message.type(), message.text()));
try {
  const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const first = await browser.newPage();
  const second = await browser.newPage();
  for (const page of [first, second]) {
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`chrome-extension://${extensionId}/panel.html`);
    await expect(page.locator('#status')).toHaveText('Connected');
    await expect(page.getByText('Counter: 0', { exact: true })).toBeVisible();
  }
  await first.getByRole('button', { name: 'Increase counter', exact: true }).click();
  for (const page of [first, second])
    await expect(page.getByText('Counter: 1', { exact: true })).toBeVisible();
  await Promise.all(
    [first, second].map((page) => page.getByRole('button', { name: 'Caller identity' }).click()),
  );
  for (const page of [first, second])
    await expect(page.locator('#result')).toContainText('panel.html');
  const firstIdentity = JSON.parse(await first.locator('#result').innerText());
  const secondIdentity = JSON.parse(await second.locator('#result').innerText());
  assert.notEqual(firstIdentity.id, secondIdentity.id);
  await second.getByRole('button', { name: 'Native write', exact: true }).click();
  for (const page of [first, second])
    await expect(page.getByText('Counter: 10', { exact: true })).toBeVisible();
  await first.getByRole('button', { name: 'Rich value', exact: true }).click();
  await expect(first.locator('#result')).toHaveText('true');
  await first.getByRole('button', { name: 'Unsupported value', exact: true }).click();
  await expect(first.locator('#result')).toContainText('serialize');
  await first.getByRole('button', { name: 'Start pending action' }).click();
  await second.getByRole('button', { name: 'Execution counts' }).click();
  await expect(second.locator('#result')).toHaveText('{"started":1,"completed":0}');
  await first.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(first.locator('#status')).toHaveText('Disconnected');
  await expect(first.locator('#result')).toContainText('closed');
  await expect(first.getByRole('button', { name: 'Increase counter', exact: true })).toHaveCount(0);
  await second.getByRole('button', { name: 'Release pending action' }).click();
  await second.getByRole('button', { name: 'Execution counts' }).click();
  await expect(second.locator('#result')).toHaveText('{"started":1,"completed":1}');
  await first.reload();
  await expect(first.locator('#status')).toHaveText('Connected');
  await expect(first.getByText('Counter: 10', { exact: true })).toBeVisible();
  await first.getByRole('button', { name: 'Execution counts' }).click();
  await expect(first.locator('#result')).toHaveText('{"started":1,"completed":1}');
  await first.getByRole('button', { name: 'Increase counter', exact: true }).click();
  for (const page of [first, second])
    await expect(page.getByText('Counter: 11', { exact: true })).toBeVisible();
  const denied = await browser.newPage();
  denied.on('pageerror', (error) => errors.push(error.message));
  await denied.goto(`chrome-extension://${extensionId}/denied.html`);
  await expect(denied.locator('#status')).toHaveText('Disconnected');
  await expect(denied.locator('#result')).toContainText('closed');
  await expect(denied.locator('.devframes-json-render-scroll-root')).toHaveCount(0);
  await denied.close();
  await second.getByRole('button', { name: 'Worker disconnect' }).click();
  await expect(second.locator('#status')).toHaveText('Disconnected');
  await expect(second.locator('#result')).toContainText('closed');
  await expect(first.locator('#status')).toHaveText('Connected');
  assert.deepEqual(errors, []);
  await first.screenshot({ path: 'native-port-proof.png', fullPage: true });
  const receipt = {
    browser: browser.browser()?.version(),
    checks: [
      'two real Ports',
      'native renderer action',
      'caller identity',
      'native state write',
      'Map/BigInt round trip',
      'function rejection',
      'pending call rejects on disconnect',
      'renderer unmount',
      'backend completion without replay',
      'reconnect with retained worker state',
      'denied sender and failed-mount cleanup',
      'worker-initiated disconnect',
    ],
    pageErrors: errors,
  };
  await writeFile('receipt.json', JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} catch (error) {
  console.error({ errors });
  throw error;
} finally {
  await browser.close();
  await rm(profile, { recursive: true, force: true });
}
