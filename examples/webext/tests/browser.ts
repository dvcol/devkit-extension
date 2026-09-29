import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { styleText } from 'node:util';
import { chromium, expect } from '@playwright/test';

const extensionPath = resolve('dist');
const profile = await mkdtemp(join(tmpdir(), 'native-port-chromium-'));
const browser = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
const errors: string[] = [];
browser.on('console', (message) => {
  console.info(styleText('cyan', '🧪 [webext]'), message.type(), message.text());
});
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
    await expect(page.locator('#catalog')).toHaveText('active');
  }
  const providerIdentity = await first.locator('#provider').innerText();
  assert.equal(await second.locator('#provider').innerText(), providerIdentity);
  await first.getByRole('button', { name: 'Increase counter', exact: true }).click();
  for (const page of [first, second])
    await expect(page.getByText('Counter: 1', { exact: true })).toBeVisible();
  await Promise.all(
    [first, second].map((page) => page.getByRole('button', { name: 'Caller identity' }).click()),
  );
  for (const page of [first, second])
    await expect(page.locator('#result')).toContainText('panel.html');
  const firstIdentity = await first.locator('#result').innerText();
  const secondIdentity = await second.locator('#result').innerText();
  assert.notEqual(firstIdentity, secondIdentity);
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
  assert.equal(await first.locator('#provider').innerText(), providerIdentity);
  await first.getByRole('button', { name: 'Execution counts' }).click();
  await expect(first.locator('#result')).toHaveText('{"started":1,"completed":1}');
  await first.getByRole('button', { name: 'Increase counter', exact: true }).click();
  for (const page of [first, second])
    await expect(page.getByText('Counter: 11', { exact: true })).toBeVisible();
  await first.getByRole('button', { name: 'Routed increase', exact: true }).click();
  await expect(first.locator('#result')).toHaveText('12');
  await second.getByRole('button', { name: 'Read capability', exact: true }).click();
  await expect(second.locator('#result')).toHaveText('12');
  await first.getByRole('button', { name: 'Broadcast increase', exact: true }).click();
  await expect(first.locator('#result')).toContainText('fulfilled');
  for (const page of [first, second])
    await expect(page.getByText('Counter: 13', { exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Disable service', exact: true }).click();
  for (const page of [first, second]) await expect(page.locator('#catalog')).toHaveText('disabled');
  await first.getByRole('button', { name: 'Routed increase', exact: true }).click();
  await expect(first.locator('#result')).toContainText('No currently available provider');
  await second.getByRole('button', { name: 'Enable service', exact: true }).click();
  for (const page of [first, second]) await expect(page.locator('#catalog')).toHaveText('active');
  await first.getByRole('button', { name: 'Routed increase', exact: true }).click();
  await expect(first.locator('#result')).toHaveText('14');
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
  await first.getByRole('button', { name: 'Read capability', exact: true }).click();
  await expect(first.locator('#result')).toHaveText('14');
  assert.deepEqual(errors, []);
  await mkdir('artifacts', { recursive: true });
  await first.screenshot({ path: 'artifacts/native-port-proof.png', fullPage: true });
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
      'shared portable action and capability contracts',
      'explicit realm/provider routing and broadcast',
      'catalog disable/enable updates on both clients',
      'provider incarnation retained across UI reconnect',
      'independent routed client survives peer disconnect',
    ],
    pageErrors: errors,
  };
  await writeFile('artifacts/receipt.json', JSON.stringify(receipt, null, 2));
  console.info(styleText('green', '✅ [webext]'), receipt);
} catch (error) {
  console.error(styleText('red', '❌ [webext]'), errors);
  throw error;
} finally {
  await browser.close();
  await rm(profile, { recursive: true, force: true });
}
