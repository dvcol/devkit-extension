import assert from 'node:assert/strict';
import type { ProviderDescriptor } from '@devkit/core';
import { counterCapability, counterStateKey } from '@devkit/example-contribution';
import { devframeHubContext } from '@devkit/server';
import type { ServerProviderHandle } from '@devkit/server';
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

/** Real JSON buttons exercise portable dispatch; lifecycle checks also write native business state. */
export async function checkCounterPages(options: {
  readonly first: Page;
  readonly second: Page;
  readonly origin: string;
  readonly provider: ServerProviderHandle;
  readonly close: () => Promise<void>;
}) {
  const { first, second, origin, provider } = options;
  await connectPage(second, origin, provider.provider);
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
  const viewLifecycle = await checkViewLifecycle(first, second, provider);
  await options.close();
  await Promise.all([disconnected(first), disconnected(second)]);
  return {
    authenticatedPages: 3,
    nativeJsonActions: 7,
    finalValue: 21,
    nativeOtpConsumed: true,
    nativePromptOnReload: true,
    sharedStateAndCapability: true,
    unmountRemount: true,
    explicitDisconnectAndReconnect: true,
    backendCloseUnmountsBoth: true,
    viewLifecycle,
  };
}

export async function disconnected(page: Page) {
  await expect(page.locator('#connection')).toHaveText('Disconnected. Reload to reconnect.');
  await expect(page.locator('#counter button')).toHaveCount(0);
  await expect(page.locator('#read')).toBeDisabled();
  await expect(page.locator('#mount')).toBeDisabled();
}

async function checkViewLifecycle(first: Page, second: Page, provider: ServerProviderHandle) {
  const resolution = await provider.resolve({ capability: counterCapability });
  assert.equal(resolution.status, 'available');
  assert.equal(resolution.binding.context.access, 'local');
  const context = resolution.binding.context.native.get(devframeHubContext);
  assert.ok(context);
  const state = await context.rpc.sharedState.get<{ value: number }>(counterStateKey);
  const service = provider.startup.services[0];
  assert.ok(service);
  const detachedButton = await second
    .getByRole('button', { name: 'Increase counter', exact: true })
    .elementHandle();
  await first.locator('#unmount').click();
  await service.disable();
  await expect(first.locator('#counter button')).toHaveCount(0);
  await expect(second.locator('#counter button')).toHaveCount(0);
  await expect(first.locator('#mount')).toBeDisabled();
  await expect(second.locator('#mount')).toBeDisabled();
  state.mutate((value) => {
    value.value = 20;
  });
  await service.enable();
  await counterValue(second, 20);
  await expect(second.locator('#counter button')).toHaveCount(2);
  await expect(first.locator('#counter button')).toHaveCount(0);
  await expect(first.locator('#mount')).toBeEnabled();
  assert.equal(await detachedButton.evaluate((button) => button.isConnected), false);
  await second.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await counterValue(second, 21);
  await readCapability(second, 21);
  await first.locator('#mount').click();
  await counterValue(first, 21);
  await expect(first.locator('#counter button')).toHaveCount(2);
  assert.equal(state.value().value, 21);
  await detachedButton.dispose();
  return {
    dependencyLossUnmounts: true,
    nativeWriteWhileAbsent: 20,
    reenableUsesCurrentState: true,
    manualUnmountRetained: true,
    previousButtonDetached: true,
    singleMountAfterRestore: true,
  };
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
