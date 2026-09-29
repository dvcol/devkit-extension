import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { getTempAuthCode } from 'devframe/node/auth';
import { z } from 'zod';
import type { NativeHost } from './caller-driver.ts';
import { poll, send } from './driver.ts';
import { prepareResponseSchema, stateResponseSchema } from './protocol.ts';

type BrokerState = ReturnType<NativeHost['service']['broker']['snapshot']>;
const recoveryKey = 'owned-native-provider-recovery';
const recoverySchema = z.object({
  [recoveryKey]: z.object({
    version: z.literal(1),
    scopes: z.array(z.object({ requestId: z.string() })),
    targets: z.array(z.object({ id: z.string(), generation: z.number().int() })),
  }),
});

/** Explicit fixture setup owns reauthentication; CDB owns pairing and target restoration. */
export async function checkWorkerRestart(control: Page, host: NativeHost) {
  const initial = await send(control, { kind: 'state' }, stateResponseSchema);
  assert.equal(initial.pairingConfirmations, 1);
  const previous = host.service.broker.snapshot();
  await waitForRecoveryStorage(control, previous);
  await stopWorker(control);
  await poll(
    () => host.sessions.size,
    (size) => size === 0,
    'terminated worker peer disconnect',
  );
  await host.settled();
  assert.deepEqual(host.errors, []);
  const stopped = host.service.broker.snapshot();
  assert.equal(stopped.providers[0]?.state, 'recovering');
  assert.equal(stopped.grants[0]?.state, 'recovering');
  assert.equal(stopped.leases.length, 0);
  const woken = await send(control, { kind: 'state' }, stateResponseSchema);
  assert.equal(woken.status, null);
  assert.equal(woken.isTrusted, null);
  assert.equal(woken.targetTabId, null);
  assert.deepEqual(woken.approvals, []);
  assert.deepEqual(woken.errors, []);
  await prepareReplacement(control, host);
  const restored = await poll(
    () => host.service.broker.snapshot(),
    (state) => state.providers[0]?.state === 'ready' && state.grants[0]?.state === 'active',
    'native provider restoration',
  );
  checkRestoredAuthority(previous, restored);
  const state = await send(control, { kind: 'state' }, stateResponseSchema);
  assert.equal(state.pairingConfirmations, 0);
  assert.deepEqual(state.approvals, []);
  assert.deepEqual(state.errors, []);
  return {
    workerStopped: true,
    wakeDidNotReconnect: true,
    explicitNativeAuthentication: true,
    nativePairingRetained: true,
    originalScopeRestored: true,
    targetGenerationAdvanced: true,
    newApprovals: 0,
    leases: restored.leases.length,
  };
}

async function waitForRecoveryStorage(control: Page, state: BrokerState) {
  assert.equal(state.grants.length, 1);
  assert.equal(state.targets.length, 1);
  const grant = state.grants[0];
  const target = state.targets[0];
  assert.ok(grant);
  assert.ok(target);
  await poll(
    async () =>
      recoverySchema.safeParse(
        await control.evaluate((key) => chrome.storage.session.get(key), recoveryKey),
      ),
    (result) =>
      result.success &&
      result.data[recoveryKey].scopes.some((entry) => entry.requestId === grant.requestId) &&
      result.data[recoveryKey].targets.some(
        (entry) => entry.id === target.id && entry.generation === target.generation,
      ),
    'native recovery persistence before worker termination',
  );
}

async function stopWorker(control: Page) {
  await using cleanup = new AsyncDisposableStack();
  const session = await control.context().newCDPSession(control);
  cleanup.defer(() => session.detach());
  const scriptURL = new URL('background.js', control.url()).href;
  let versionId: string | undefined;
  let stopped = false;
  session.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
    for (const version of versions) {
      if (version.scriptURL !== scriptURL) continue;
      if (version.runningStatus === 'running') versionId = version.versionId;
      if (version.versionId === versionId && version.runningStatus === 'stopped') stopped = true;
    }
  });
  await session.send('ServiceWorker.enable');
  await poll(
    () => versionId,
    (value) => value !== undefined,
    'owned extension worker version',
  );
  assert.notEqual(versionId, undefined);
  if (versionId === undefined) throw new Error('The owned worker version is unavailable');
  await session.send('ServiceWorker.stopWorker', { versionId });
  await poll(() => stopped, Boolean, 'owned worker termination');
}

async function prepareReplacement(control: Page, host: NativeHost) {
  const prepared = await send(
    control,
    {
      kind: 'prepare',
      baseURL: host.baseURL,
      fixtureUrl: host.fixtureUrl,
      code: getTempAuthCode(),
    },
    prepareResponseSchema,
  );
  assert.equal(prepared.unauthenticatedRejected, true);
  assert.equal(prepared.unauthenticatedReason, 'native-unauthorized');
  assert.equal(prepared.trustedBeforeCode, false);
  assert.equal(prepared.invalidCodeAccepted, false);
  assert.equal(prepared.validCodeAccepted, true);
  assert.equal(prepared.currentTrusted, true);
  assert.equal(prepared.echo, 'authenticated-before-provider');
}

function checkRestoredAuthority(previous: BrokerState, restored: BrokerState) {
  const provider = restored.providers[0];
  const target = restored.targets[0];
  const grant = restored.grants[0];
  const oldTarget = previous.targets[0];
  const oldGrant = previous.grants[0];
  assert.equal(restored.providers.length, 1);
  assert.equal(restored.targets.length, 1);
  assert.equal(restored.grants.length, 1);
  assert.ok(provider);
  assert.ok(target);
  assert.ok(grant);
  assert.ok(oldTarget);
  assert.ok(oldGrant);
  assert.equal(provider.id, previous.providers[0]?.id);
  assert.equal(provider.instanceId, previous.providers[0]?.instanceId);
  assert.equal(provider.paired, true);
  assert.equal(target.id, oldTarget.id);
  assert.equal(target.generation, oldTarget.generation + 1);
  assert.equal(grant.requestId, oldGrant.requestId);
  assert.equal(grant.principalId, oldGrant.principalId);
  assert.equal(grant.targetId, target.id);
  assert.equal(grant.targetGeneration, target.generation);
  assert.notEqual(grant.id, oldGrant.id);
  assert.deepEqual(restored.scopes, previous.scopes);
  assert.equal(restored.leases.length, 0);
}
