import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  checkTimingRegistration,
  checkTimingInstallation,
  checkTimingSnapshot,
  readTimingSnapshot,
  readUnmatchedMarkers,
  readTimingRegistration,
  startTimingServer,
} from './script-timing.ts';

export async function checkScriptTiming(extension: Page, artifactDirectory: string): Promise<void> {
  await using cleanup = new AsyncDisposableStack();
  const { url, close } = await startTimingServer();
  cleanup.defer(close);
  const source = await extension.context().newPage();
  cleanup.defer(() => source.close());
  const observations = [];
  const lifecycle = [];
  const checks = [];
  for (const world of ['MAIN', 'ISOLATED'] as const) {
    const installed = await control(extension, `#script-${world.toLowerCase()}`, 'ready', 1);
    try {
      checkTimingRegistration(await extension.evaluate(readTimingRegistration), world);
      await source.goto(`${url}index.html`);
      observations.push(checkTimingSnapshot(await source.evaluate(readTimingSnapshot), world));
      const disabled = await control(extension, '#script-disable', 'disabled', 1);
      assert.deepEqual(await extension.evaluate(readTimingRegistration), []);
      assert.deepEqual(await source.evaluate(readUnmatchedMarkers), {
        global: world === 'MAIN',
        listener: 'loading',
      });
      await source.reload();
      checkTimingSnapshot(await source.evaluate(readTimingSnapshot));
      const enabled = await control(extension, '#script-enable', 'ready', 2);
      checkTimingRegistration(await extension.evaluate(readTimingRegistration), world);
      await source.reload();
      checkTimingSnapshot(await source.evaluate(readTimingSnapshot), world);
      lifecycle.push({ world, installed, disabled, enabled });
      await source.goto(url);
      assert.deepEqual(await source.evaluate(readUnmatchedMarkers), {
        global: false,
        listener: null,
      });
    } finally {
      await control(extension, '#script-dispose', 'disposed');
      assert.deepEqual(await extension.evaluate(readTimingRegistration), []);
    }
    checks.push(`${world}: script contribution install disable enable dispose and native timing`);
  }
  await source.goto(`${url}index.html`);
  observations.push(checkTimingSnapshot(await source.evaluate(readTimingSnapshot)));
  await writeFile(
    `${artifactDirectory}/script-timing.json`,
    JSON.stringify(
      { browser: extension.context().browser()?.version(), observations, lifecycle, checks },
      null,
      2,
    ),
  );
}

async function control(extension: Page, selector: string, status: string, generation?: number) {
  await extension.locator(selector).click();
  await expect(extension.locator('#result')).not.toHaveText('Pending');
  const snapshot: unknown = JSON.parse(await extension.locator('#result').innerText());
  checkTimingInstallation(snapshot, status, generation);
  return snapshot;
}
