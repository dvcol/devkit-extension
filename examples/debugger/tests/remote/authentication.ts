import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { getTempAuthCode } from 'devframe/node/auth';
import { z } from 'zod';
import { remoteDebuggerAgent as agent } from '../../src/remote-service.ts';
import type { createNativeHost } from './host.ts';
import { poll, send } from './driver.ts';
import { prepareResponseSchema, stateResponseSchema, approveResponseSchema } from './protocol.ts';

type NativeHost = Awaited<ReturnType<typeof createNativeHost>>;
export { agent };

export async function checkTrust(control: Page, host: NativeHost) {
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
  assert.equal(prepared.state.isolated, true);
  assert.equal(prepared.echo, 'authenticated-before-provider');
  assert.deepEqual(prepared.state.errors, []);
  const ready = await poll(
    () => host.service.broker.snapshot(),
    (snapshot) => snapshot.providers.some((provider) => provider.state === 'ready'),
    'native pairing',
  );
  assert.equal(ready.providers.length, 1);
  assert.equal(ready.grants.length, 0);
  assert.equal(ready.scopes.length, 0);
  return { prepared, pairing: { providers: ready.providers.length, grants: ready.grants.length } };
}

export async function approveTarget(control: Page, host: NativeHost) {
  await host.service.broker.connectSession(agent);
  const access = host.service.broker.invoke(agent, 'browser.request_access', { level: 'debug' });
  const outcome = access.then(
    () => ({ accepted: true }),
    () => ({ accepted: false }),
  );
  const requested = await poll(
    () => host.service.broker.snapshot(),
    (snapshot) => snapshot.requests.some((request) => request.state === 'pending'),
    'explicit approval request',
  );
  const request = requested.requests.find((candidate) => candidate.state === 'pending');
  assert.ok(request);
  assert.equal(requested.grants.length, 0);
  await send(control, { kind: 'approve', requestId: request.id }, approveResponseSchema);
  assert.deepEqual(await outcome, { accepted: true });
  const state = await send(control, { kind: 'state' }, stateResponseSchema);
  assert.equal(state.approvals.length, 1);
  assert.deepEqual(state.approvals[0], {
    requestId: request.id,
    selector: { kind: 'explicit-tabs', tabIds: [state.targetTabId] },
    accepted: true,
    senderURL: control.url(),
  });
  assert.deepEqual(state.errors, []);
  const targets = z
    .array(z.object({ targetRef: z.string() }))
    .parse(await host.service.broker.invoke(agent, 'browser.list_targets', {}));
  assert.equal(targets.length, 1);
  const target = targets[0];
  assert.ok(target);
  return { targetRef: target.targetRef, approvals: state.approvals };
}
