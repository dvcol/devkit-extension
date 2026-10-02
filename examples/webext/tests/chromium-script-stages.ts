import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  checkHeldSubresource,
  checkScriptStageSnapshot,
  readScriptStageSnapshot,
  startScriptStageServer,
} from './script-stages.ts';
import type { ScriptStageOptions, ScriptStageServer } from './script-stages.ts';
import {
  checkTimingInstallation,
  checkTimingRegistration,
  readTimingRegistration,
} from './script-timing.ts';

interface StagePages {
  readonly extension: Page;
  readonly source: Page;
  readonly fixture: ScriptStageServer;
}

export async function checkChromiumScriptStages(extension: Page, artifactDirectory: string) {
  await using cleanup = new AsyncDisposableStack();
  const fixture = await startScriptStageServer();
  cleanup.defer(() => fixture.close());
  const source = await extension.context().newPage();
  cleanup.defer(() => source.close());
  const pages = { extension, source, fixture };
  const observations = [];
  const checks = [];
  for (const world of ['MAIN', 'ISOLATED'] as const) {
    for (const runAt of ['document_start', 'document_end', 'document_idle'] as const) {
      observations.push(await checkRegistration(pages, { world, runAt }));
      checks.push(`${world}: native ${runAt} timing, world visibility and disposal`);
      if (runAt !== 'document_start')
        checks.push(
          `${world}: ${runAt} disable preserves existing effects; enable injects fresh documents`,
        );
    }
  }
  await extension.locator('#script-run-at').selectOption('document_start');
  await writeFile(
    `${artifactDirectory}/script-stages.json`,
    JSON.stringify(
      {
        browser: extension.context().browser()?.version(),
        observations,
        checks,
      },
      null,
      2,
    ),
  );
}

async function checkRegistration(pages: StagePages, options: ScriptStageOptions) {
  const { extension, source } = pages;
  const { world, runAt } = options;
  await extension.locator('#script-run-at').selectOption(runAt);
  const installed = await control(extension, {
    identifier: `script-${world.toLowerCase()}`,
    status: 'ready',
    generation: 1,
  });
  let initial;
  let lifecycle;
  let disposal;
  try {
    checkTimingRegistration(installed.registrations, world, { runAt });
    initial = await observeDocument(pages, options);
    if (runAt !== 'document_start') lifecycle = await checkLifecycle(pages, options);
  } finally {
    disposal = await control(extension, { identifier: 'script-dispose', status: 'disposed' });
    assert.deepEqual(disposal.registrations, []);
  }
  const retained = await source.evaluate(readScriptStageSnapshot);
  checkScriptStageSnapshot(retained, options);
  const disposed = await observeDocument(pages, { ...options, active: false });
  return { ...options, installed, initial, lifecycle, disposal, retained, disposed };
}

async function observeDocument(pages: StagePages, options: ScriptStageOptions) {
  const { source, fixture } = pages;
  fixture.hold();
  try {
    await source.goto(fixture.url, { waitUntil: 'domcontentloaded' });
    if (options.active !== false && options.runAt !== 'document_idle')
      await expect
        .poll(async () => (await source.evaluate(readScriptStageSnapshot)).injectedReadyState)
        .not.toBeNull();
    const held = await source.evaluate(readScriptStageSnapshot);
    checkHeldSubresource(held);
    if (options.active !== false && options.runAt !== 'document_idle')
      checkScriptStageSnapshot(held, options);
    fixture.release();
    await source.waitForLoadState('load');
    if (options.active !== false)
      await expect
        .poll(async () => (await source.evaluate(readScriptStageSnapshot)).injectedReadyState)
        .not.toBeNull();
    const complete = await source.evaluate(readScriptStageSnapshot);
    checkScriptStageSnapshot(complete, options);
    assert.equal(complete.windowLoaded, true);
    assert.equal(complete.imageComplete, true);
    return { held, complete };
  } finally {
    fixture.release();
  }
}

async function checkLifecycle(pages: StagePages, options: ScriptStageOptions) {
  const { extension, source } = pages;
  const disabled = await control(extension, {
    identifier: 'script-disable',
    status: 'disabled',
    generation: 1,
  });
  assert.deepEqual(disabled.registrations, []);
  const retained = await source.evaluate(readScriptStageSnapshot);
  checkScriptStageSnapshot(retained, options);
  const inactive = await observeDocument(pages, { ...options, active: false });
  const enabled = await control(extension, {
    identifier: 'script-enable',
    status: 'ready',
    generation: 2,
  });
  checkTimingRegistration(enabled.registrations, options.world, { runAt: options.runAt });
  const restored = await observeDocument(pages, options);
  return { disabled, retained, inactive, enabled, restored };
}

async function control(
  extension: Page,
  options: {
    identifier: string;
    status: string;
    generation?: number;
  },
) {
  await extension.locator(`#${options.identifier}`).click();
  await expect(extension.locator('#result')).not.toHaveText('Pending');
  const snapshot: unknown = JSON.parse(await extension.locator('#result').innerText());
  checkTimingInstallation(snapshot, options.status, options.generation);
  return { snapshot, registrations: await extension.evaluate(readTimingRegistration) };
}
