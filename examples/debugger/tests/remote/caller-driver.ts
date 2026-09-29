import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { publishedTargetSchema } from '@dvcol/cdb';
import { getTempAuthCode } from 'devframe/node/auth';
import type { DebuggerTarget } from '../../src/contracts.ts';
import type { createNativeHost } from './host.ts';
import { poll, send } from './driver.ts';
import { approveResponseSchema } from './protocol.ts';

export type NativeHost = Awaited<ReturnType<typeof createNativeHost>>;

export interface CallerFixture {
  readonly host: NativeHost;
  readonly page: Page;
  readonly targetPage: Page;
  readonly target: DebuggerTarget;
}

export async function connectCaller(page: Page, baseURL: string) {
  await page.waitForFunction(() => typeof window.connectCaller === 'function');
  await page.evaluate(
    async (request) => {
      window.caller = await window.connectCaller(request.baseURL, request.code);
      if (window.caller.trusted !== true)
        throw new Error('The separate native caller is not trusted');
    },
    { baseURL, code: getTempAuthCode() },
  );
}

export async function approveCaller(host: NativeHost, control: Page, page: Page) {
  const previous = host.service.broker.snapshot().grants;
  const access = page
    .evaluate(() => window.caller.requestAccess())
    .then(
      () => ({ accepted: true }),
      () => ({ accepted: false }),
    );
  const snapshot = await poll(
    () => host.service.broker.snapshot(),
    (state) => state.requests.some((request) => request.state === 'pending'),
    'the separate caller approval request',
  );
  const request = snapshot.requests.find((entry) => entry.state === 'pending');
  assert.ok(request);
  const response = await send(
    control,
    { kind: 'approve', requestId: request.id },
    approveResponseSchema,
  );
  assert.deepEqual(await access, { accepted: true });
  assert.deepEqual(response.errors, []);
  const grants = host.service.broker.snapshot().grants;
  const principalCount = new Set(grants.map((grant) => grant.principalId)).size;
  const targetCount = new Set(grants.map((grant) => grant.targetId)).size;
  assert.equal(grants.length, previous.length + 1);
  assert.equal(principalCount, new Set(previous.map((grant) => grant.principalId)).size + 1);
  assert.equal(targetCount, 1);
  return { count: response.approvals.length, principalCount, targetCount };
}

export async function readTarget(value: unknown) {
  assert.ok(Array.isArray(value));
  assert.equal(value.length, 1);
  const target = await publishedTargetSchema['~standard'].validate(value[0]);
  if (target.issues !== undefined) throw new Error('Native target did not pass its public schema');
  return { id: target.value.id, generation: target.value.generation };
}

export async function rejectedByNative(
  host: NativeHost,
  invocation: Promise<unknown>,
  code: string,
) {
  const previous = host.diagnostics.length;
  await assert.rejects(invocation);
  assert.equal(host.service.broker.snapshot().leases.length, 0);
  const diagnostics = host.diagnostics.slice(previous);
  assert.ok(diagnostics.length > 0);
  assert.ok(diagnostics.every(({ diagnostic }) => diagnostic.code === 'operation-failed'));
  assert.ok(
    diagnostics.some(
      ({ cause }) =>
        typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === code,
    ),
  );
}
