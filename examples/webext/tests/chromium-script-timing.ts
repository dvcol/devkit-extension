import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import {
  checkTimingRegistration,
  checkTimingSnapshot,
  readTimingSnapshot,
  readUnmatchedMarkers,
  registerTimingScript,
  startTimingServer,
  unregisterTimingScript,
} from './script-timing.ts';

export async function checkScriptTiming(extension: Page, artifactDirectory: string): Promise<void> {
  await using cleanup = new AsyncDisposableStack();
  const { url, close } = await startTimingServer();
  cleanup.defer(close);
  const source = await extension.context().newPage();
  cleanup.defer(() => source.close());
  const observations = [];
  for (const world of ['MAIN', 'ISOLATED'] as const) {
    const registration = await extension.evaluate(registerTimingScript, world);
    try {
      checkTimingRegistration(registration, world);
      await source.goto(`${url}index.html`);
      observations.push(checkTimingSnapshot(await source.evaluate(readTimingSnapshot), world));
      await source.goto(url);
      assert.deepEqual(await source.evaluate(readUnmatchedMarkers), {
        global: false,
        listener: null,
      });
    } finally {
      assert.deepEqual(await extension.evaluate(unregisterTimingScript), []);
    }
  }
  await source.goto(`${url}index.html`);
  observations.push(checkTimingSnapshot(await source.evaluate(readTimingSnapshot)));
  await writeFile(
    `${artifactDirectory}/script-timing.json`,
    JSON.stringify({ browser: extension.context().browser()?.version(), observations }, null, 2),
  );
}
