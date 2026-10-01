import assert from 'node:assert/strict';
import type { ProviderDescriptor } from '@devkit/core';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { buildOtpAuthUrl, getTempAuthCodeInfo } from 'devframe/node/auth';

/** Use the running native host's single-use OTP; no token is injected into browser assets. */
export async function connectPage(page: Page, origin: string, provider: ProviderDescriptor) {
  await page.goto(buildOtpAuthUrl(origin, getTempAuthCodeInfo().code));
  await expect(page.locator('#connection')).toHaveText('Connected');
  assert.equal(new URL(page.url()).hash, '');
  assert.deepEqual(JSON.parse((await page.locator('#provider').textContent()) ?? ''), provider);
  await expect(page.locator('#counter button')).toHaveCount(2);
}

export async function counterValue(page: Page, value: number) {
  await expect(page.locator('#counter')).toContainText(`Counter: ${value}`);
}

async function readCapability(page: Page, value: number) {
  await page.locator('#read').click();
  await expect(page.locator('#result')).toHaveText(JSON.stringify({ value }));
}

/** All mutations below come from the actual native JSON button through the portable router. */
export async function checkCounterPages(options: {
  readonly first: Page;
  readonly second: Page;
  readonly origin: string;
  readonly provider: ProviderDescriptor;
  readonly close: () => Promise<void>;
}) {
  const { first, second, origin, provider } = options;
  await connectPage(second, origin, provider);
  await counterValue(first, 0);
  await counterValue(second, 0);
  await first.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await counterValue(first, 1);
  await counterValue(second, 1);
  await second.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await counterValue(first, 2);
  await counterValue(second, 2);
  await readCapability(first, 2);
  await readCapability(second, 2);

  await checkRemount(first, second);

  await first.locator('#disconnect').click();
  await disconnected(first);
  await second.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await counterValue(second, 5);
  await readCapability(second, 5);
  await reloadPage(first);
  await counterValue(first, 5);
  await first.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await counterValue(first, 6);
  await counterValue(second, 6);
  await readCapability(first, 6);
  await expect(first.getByRole('button', { name: 'Increase counter', exact: true })).toBeEnabled();
  await options.close();
  await disconnected(first);
  await disconnected(second);
  return {
    authenticatedPages: 3,
    nativeJsonActions: 6,
    finalValue: 6,
    nativeOtpConsumed: true,
    nativePromptOnReload: true,
    sharedStateAndCapability: true,
    unmountRemount: true,
    explicitDisconnectAndReconnect: true,
    backendCloseUnmountsBoth: true,
  };
}

export async function disconnected(page: Page) {
  await expect(page.locator('#connection')).toHaveText('Disconnected. Reload to reconnect.');
  await expect(page.locator('#counter button')).toHaveCount(0);
  await expect(page.locator('#read')).toBeDisabled();
  await expect(page.locator('#mount')).toBeDisabled();
}

async function checkRemount(first: Page, second: Page) {
  await first.locator('#unmount').click();
  await expect(first.locator('#counter button')).toHaveCount(0);
  await second.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await counterValue(second, 3);
  await expect(first.locator('#counter button')).toHaveCount(0);
  await first.locator('#mount').click();
  await counterValue(first, 3);
  await expect(first.locator('#counter button')).toHaveCount(2);
  await first.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await counterValue(first, 4);
  await counterValue(second, 4);
}

async function reloadPage(page: Page) {
  const previousDocument = await page.evaluate(() => performance.timeOrigin);
  const prompt = page.waitForEvent('dialog');
  const reload = page.locator('#reload').click();
  const dialog = await prompt;
  assert.equal(dialog.type(), 'prompt');
  await dialog.accept(getTempAuthCodeInfo().code);
  await reload;
  await expect(page.locator('#connection')).toHaveText('Connected');
  assert.notEqual(await page.evaluate(() => performance.timeOrigin), previousDocument);
  await expect(page.locator('#counter button')).toHaveCount(2);
}
