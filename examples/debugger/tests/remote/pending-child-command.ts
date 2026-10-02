import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { createNativeBrowser } from './browser.ts';
import { command } from './child-commands.ts';
import type { CommandFixture } from './child-commands.ts';
import { poll } from './driver.ts';

interface CommandObservation {
  outcome?:
    | { status: 'fulfilled'; value: unknown; elapsedMilliseconds: number }
    | { status: 'rejected'; error: unknown; elapsedMilliseconds: number };
}

export async function startPendingChildCommand({
  browser,
  sessionId,
  ...fixture
}: CommandFixture & {
  browser: Awaited<ReturnType<typeof createNativeBrowser>>;
  sessionId: string;
}) {
  const observation: CommandObservation = {};
  const startedAt = performance.now();
  void command(fixture, {
    method: 'Runtime.evaluate',
    sessionId,
    parameters: {
      expression:
        'document.documentElement.dataset.pendingChildCommand="started";new Promise(() => {})',
      awaitPromise: true,
      returnByValue: true,
    },
  }).then(
    (value) =>
      (observation.outcome = {
        status: 'fulfilled',
        value,
        elapsedMilliseconds: performance.now() - startedAt,
      }),
    (error: unknown) =>
      (observation.outcome = {
        status: 'rejected',
        error,
        elapsedMilliseconds: performance.now() - startedAt,
      }),
  );
  await poll(
    () =>
      browser.target
        .frameLocator('#owned-child')
        .locator('html')
        .evaluate((element) => element.dataset.pendingChildCommand),
    (marker) => marker === 'started',
    'started native child command',
  );
  assert.equal(observation.outcome, undefined);
  return observation;
}

/** Records a bounded observation; child removal does not currently settle Chrome's command. */
export async function observePendingChildCommand(observation: CommandObservation) {
  const startedAt = performance.now();
  while (observation.outcome === undefined && performance.now() - startedAt < 1_000)
    await delay(25);
  assert.equal(observation.outcome, undefined);
  return { status: 'pending', observationMilliseconds: performance.now() - startedAt };
}

export async function readChildCommandCleanup(observation: CommandObservation) {
  const outcome = await poll(
    () => observation.outcome,
    (result) => result !== undefined,
    'pending child command cleanup',
  );
  assert.ok(outcome?.status === 'rejected');
  const error = z
    .object({
      code: z.literal('REQUEST_CANCELLED'),
      message: z.literal('The requested target operation is not available.'),
    })
    .parse(outcome.error);
  return { status: outcome.status, ...error, elapsedMilliseconds: outcome.elapsedMilliseconds };
}
