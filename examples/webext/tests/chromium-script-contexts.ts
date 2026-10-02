import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  checkScriptContexts,
  readOptionalHostPermission,
  readScriptContextSnapshot,
  scriptContextReady,
  startScriptContextServer,
} from './script-contexts.ts';
import type { ScriptContextOptions, ScriptContextServer } from './script-contexts.ts';
import {
  checkTimingInstallation,
  checkTimingRegistration,
  readTimingRegistration,
} from './script-timing.ts';

export async function checkChromiumScriptContexts(extension: Page, artifactDirectory: string) {
  await using cleanup = new AsyncDisposableStack();
  const fixture = await startScriptContextServer();
  cleanup.defer(() => fixture.close());
  const source = await extension.context().newPage();
  cleanup.defer(() => source.close());
  const optionalHostBefore = await extension.evaluate(readOptionalHostPermission);
  assert.equal(optionalHostBefore, false);
  const observations = [];
  const checks = [];
  for (const world of ['MAIN', 'ISOLATED'] as const) {
    for (const allFrames of [false, true]) {
      const result = await checkRegistration({ extension, source, fixture, world, allFrames });
      observations.push(...result.observations);
      checks.push(...result.checks);
    }
  }
  await extension.locator('#script-all-frames').uncheck();
  const optionalHostAfter = await extension.evaluate(readOptionalHostPermission);
  assert.equal(optionalHostAfter, false);
  await writeFile(
    `${artifactDirectory}/script-contexts.json`,
    JSON.stringify(
      {
        browser: extension.context().browser()?.version(),
        optionalHostPermissions: { before: optionalHostBefore, after: optionalHostAfter },
        observations,
        checks,
      },
      null,
      2,
    ),
  );
}

async function checkRegistration(options: {
  extension: Page;
  source: Page;
  fixture: ScriptContextServer;
  world: `${chrome.scripting.ExecutionWorld}`;
  allFrames: boolean;
}) {
  const { extension, source, fixture, world, allFrames } = options;
  const observations = [];
  const checks = [];
  let disposal: Awaited<ReturnType<typeof control>> | undefined;
  await extension.locator('#script-all-frames').setChecked(allFrames);
  const installed = await control(extension, `script-${world.toLowerCase()}`, 'ready', 1);
  try {
    checkTimingRegistration(installed.registrations, world, allFrames);
    for (const strictCsp of [false, true]) {
      fixture.setStrictCsp(strictCsp);
      await source.goto(fixture.url);
      const current = { world, allFrames, strictCsp, active: true };
      observations.push({ ...current, installed, snapshots: await readFrames(source, current) });
      checks.push(
        `${world}: allFrames=${allFrames} strictCsp=${strictCsp} native frame matching and host permissions`,
      );
    }
    if (allFrames) {
      observations.push(await checkLifecycle(extension, source, world));
      checks.push(`${world}: native child-frame registration disable and enable under page CSP`);
    }
  } finally {
    disposal = await control(extension, 'script-dispose', 'disposed');
    assert.deepEqual(disposal.registrations, []);
  }
  await source.reload();
  const disposed = { world, allFrames, strictCsp: true, active: false };
  observations.push({
    ...disposed,
    stage: 'disposed',
    disposal,
    snapshots: await readFrames(source, disposed),
  });
  checks.push(
    `${world}: allFrames=${allFrames} disposed registration leaves fresh documents uninjected`,
  );
  return { observations, checks };
}

async function readFrames(source: Page, options: ScriptContextOptions) {
  const frames = [
    source.mainFrame(),
    ...['same', 'cross', 'denied'].map((name) => source.frame({ name })),
  ];
  const snapshots = [];
  for (const frame of frames) {
    assert.ok(frame);
    await frame.waitForFunction(scriptContextReady, options.strictCsp);
    snapshots.push(await frame.evaluate(readScriptContextSnapshot));
  }
  checkScriptContexts(snapshots, options);
  return snapshots;
}

async function control(extension: Page, identifier: string, status: string, generation?: number) {
  await extension.locator(`#${identifier}`).click();
  await expect(extension.locator('#result')).not.toHaveText('Pending');
  const snapshot: unknown = JSON.parse(await extension.locator('#result').innerText());
  checkTimingInstallation(snapshot, status, generation);
  return { snapshot, registrations: await extension.evaluate(readTimingRegistration) };
}

async function checkLifecycle(
  extension: Page,
  source: Page,
  world: `${chrome.scripting.ExecutionWorld}`,
) {
  const options = { world, allFrames: true, strictCsp: true, active: true };
  const disabled = await control(extension, 'script-disable', 'disabled', 1);
  assert.deepEqual(disabled.registrations, []);
  const retained = await readFrames(source, options);
  await source.reload();
  const inactive = await readFrames(source, { ...options, active: false });
  const enabled = await control(extension, 'script-enable', 'ready', 2);
  checkTimingRegistration(enabled.registrations, world, true);
  await source.reload();
  const restored = await readFrames(source, options);
  return { world, stage: 'lifecycle', disabled, retained, inactive, enabled, restored };
}
