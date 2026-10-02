import assert from 'node:assert/strict';
import type { InstallationHandle } from '@devkit/core';
import type { ExampleHost } from '@devkit/example-vite-hosts';
import type { ServerProviderHandle } from '@devkit/server';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { connectPage } from './browser-counter.ts';

interface TransformBrowserOptions {
  readonly page: Page;
  readonly origin: string;
  readonly provider: ServerProviderHandle;
}

export function nativeTransformChecks(host: ExampleHost) {
  return [
    `${host}: native HTML transform hooks run pre then post despite reversed plugin configuration`,
    `${host}: disabling first HTML transform preserves second on received HTML and first page script`,
    `${host}: disabling second HTML transform preserves first on received HTML and first page script`,
    `${host}: HTML transform enable creates fresh activations and restores both native effects`,
    `${host}: disposed HTML transforms affect only future responses and preserve a surviving hook`,
    `${host}: native HTML transform failure returns HTTP 500 and next request recovers with the same provider`,
    `${host}: preview serves built HTML transform effects without executing live HTML hooks`,
  ];
}

function installation(provider: ServerProviderHandle, id: string): InstallationHandle {
  const current = provider.startup.plugins.find((candidate) => candidate.snapshot().id === id);
  assert.ok(current);
  assert.equal(current.snapshot().status, 'ready');
  assert.equal(current.snapshot().contributions[0]?.kind, 'transform');
  return current;
}

export async function pageNativeTransforms(page: Page, expected: readonly string[]) {
  await expect(page.locator('#transform-order')).toHaveText(JSON.stringify(expected));
  const observed: unknown = JSON.parse(
    (await page.locator('html').getAttribute('data-first-native-transforms')) ?? 'null',
  );
  assert.deepEqual(observed, expected);
  return observed;
}

async function observeTransforms(options: TransformBrowserOptions, expected: readonly string[]) {
  const response = await fetch(options.origin);
  assert.equal(response.status, 200);
  const html = await response.text();
  const marker = `data-native-transforms="${expected.join(',')}"`;
  assert.equal(html.includes(marker), true);
  assert.equal(html.match(/data-native-transforms="[^"]*"/gu)?.length, 1);
  await options.page.goto('about:blank');
  await connectPage(options.page, options.origin, options.provider.provider);
  return {
    receivedMarker: marker,
    firstPageScript: await pageNativeTransforms(options.page, expected),
  };
}

async function checkIndependentTransforms(
  options: TransformBrowserOptions,
  first: InstallationHandle,
  second: InstallationHandle,
) {
  const initial = await observeTransforms(options, ['first', 'second']);
  await first.disable();
  await pageNativeTransforms(options.page, ['first', 'second']);
  const disabledFirst = await observeTransforms(options, ['second']);
  await first.enable();
  assert.equal(first.snapshot().contributions[0]?.generation, 2);
  const enabledFirst = await observeTransforms(options, ['first', 'second']);
  await second.disable();
  await pageNativeTransforms(options.page, ['first', 'second']);
  const disabledSecond = await observeTransforms(options, ['first']);
  await second.enable();
  assert.equal(second.snapshot().contributions[0]?.generation, 2);
  const enabledSecond = await observeTransforms(options, ['first', 'second']);
  return { initial, disabledFirst, enabledFirst, disabledSecond, enabledSecond };
}

async function checkNativeFailure(options: TransformBrowserOptions) {
  const failed = await fetch(`${options.origin}/?transform-error`);
  assert.equal(failed.status, 500);
  assert.match(await failed.text(), /Example second native HTML transform failed/u);
  const recovered = await observeTransforms(options, ['first', 'second']);
  assert.equal(installation(options.provider, 'example.html-second').snapshot().status, 'ready');
  return { status: failed.status, recovered, contributionRemainsActive: true };
}

async function checkDisposal(
  options: TransformBrowserOptions,
  first: InstallationHandle,
  second: InstallationHandle,
) {
  await first.dispose();
  await pageNativeTransforms(options.page, ['first', 'second']);
  const disposedFirst = await observeTransforms(options, ['second']);
  assert.equal(first.snapshot().status, 'disposed');
  assert.equal(second.snapshot().status, 'ready');
  await second.dispose();
  await pageNativeTransforms(options.page, ['second']);
  const disposedBoth = await observeTransforms(options, []);
  assert.equal(second.snapshot().status, 'disposed');
  return { disposedFirst, disposedBoth, existingDocumentsRetainEffects: true };
}

/** Received bytes and parser-script observations establish these native HTML-stage guarantees. */
export async function checkTransformLifecycle(options: TransformBrowserOptions) {
  const first = installation(options.provider, 'example.html-first');
  const second = installation(options.provider, 'example.html-second');
  const independent = await checkIndependentTransforms(options, first, second);
  const failure = await checkNativeFailure(options);
  const disposal = await checkDisposal(options, first, second);
  return { independent, failure, disposal };
}
