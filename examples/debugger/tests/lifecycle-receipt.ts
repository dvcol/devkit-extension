import assert from 'node:assert/strict';
import { z } from 'zod';

const target = z.object({ id: z.string(), generation: z.number() });
const resultSchema = z.object({
  scenario: z.enum(['revoke', 'close', 'unsupported']),
  target,
  initialTitle: z.literal('Owned debugger target'),
  navigatedTitle: z.literal('Navigated debugger target'),
  targetsAfterNavigation: z.array(target),
  revocation: z.object({
    kind: z.literal('revoked'),
    targetId: z.string(),
    targetGeneration: z.number(),
    reason: z.string(),
  }),
  subscriptionResult: z.object({ done: z.literal(true) }),
  targetsAfterRevocation: z.array(z.never()),
  leasesAfterRevocation: z.array(z.never()),
  staleAction: z.object({
    rejected: z.literal(true),
    message: z.string().min(1),
    code: z.literal('operation-failed'),
    cause: z.object({ code: z.string(), message: z.string().min(1) }),
  }),
  trace: z.array(z.object({ method: z.string(), status: z.string() })),
  errors: z.array(z.never()),
  diagnostics: z.array(z.literal('operation-failed')).min(1),
  listenersAfterDisposal: z.object({
    event: z.literal(false),
    detach: z.literal(false),
    updated: z.literal(false),
    removed: z.literal(false),
  }),
});

export function assertLifecycleReceipt(receipt: unknown): void {
  const { result } = z
    .object({ passed: z.literal(true), result: z.array(resultSchema) })
    .parse(receipt);
  assert.deepEqual(
    result.map((item) => item.scenario),
    ['revoke', 'close', 'unsupported'],
  );
  for (const item of result) {
    assert.deepEqual(item.targetsAfterNavigation, [item.target]);
    assert.equal(item.revocation.targetId, item.target.id);
    assert.equal(item.revocation.targetGeneration, item.target.generation);
    assert.equal(item.trace.filter((entry) => entry.method === 'attach').length, 1);
    assert.equal(item.trace.filter((entry) => entry.method === 'Runtime.evaluate').length, 2);
    assert.ok(['TARGET_NOT_FOUND', 'TARGET_REVOKED'].includes(item.staleAction.cause.code));
    assertRevocationReason(item.scenario, item.revocation.reason);
    const detach = item.trace.filter((entry) => entry.method === 'detach');
    assert.equal(detach.length, 1);
    if (item.scenario !== 'close')
      assert.deepEqual(detach, [{ method: 'detach', status: 'fulfilled' }]);
    assert.ok(
      item.trace.every((entry) => entry.status === 'fulfilled' || entry.method === 'detach'),
    );
  }
}

function assertRevocationReason(
  scenario: z.infer<typeof resultSchema>['scenario'],
  reason: string,
): void {
  if (scenario === 'close') {
    assert.ok(['closed', 'detached'].includes(reason));
    return;
  }
  assert.equal(reason, scenario === 'revoke' ? 'explicit' : 'policy-invalid');
}
