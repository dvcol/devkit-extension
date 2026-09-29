import assert from 'node:assert/strict';
import { z } from 'zod';

const evaluation = z.object({ result: z.object({ value: z.number() }) });
const chromiumReceipt = z.object({
  passed: z.literal(true),
  result: z.object({
    title: z.string(),
    targetsAfterContributionDisposal: z.array(z.unknown()),
    outstandingLeases: z.number(),
    events: z.object({
      result: z.object({ value: evaluation }),
      event: z.object({
        done: z.literal(false),
        value: z.object({
          method: z.string(),
          parameters: z.object({ args: z.array(z.object({ value: z.string() })) }),
        }),
      }),
    }),
    rawAfterClientDisposal: evaluation,
    nativeAfterRevoke: z.string(),
    brokerAfterDisposal: z.string(),
    trace: z.array(z.object({ method: z.string(), status: z.string() })),
    errors: z.array(z.string()),
  }),
});

export function assertChromiumReceipt(receipt: unknown): void {
  const { result } = chromiumReceipt.parse(receipt);
  assert.equal(result.title, 'Owned debugger target');
  assert.equal(result.targetsAfterContributionDisposal.length, 1);
  assert.equal(result.outstandingLeases, 0);
  assert.equal(result.events.result.value.result.value, 42);
  assert.equal(result.events.event.value.method, 'Runtime.consoleAPICalled');
  assert.equal(result.events.event.value.parameters.args[0]?.value, 'devkit-cdb-event');
  assert.equal(result.rawAfterClientDisposal.result.value, 63);
  assert.match(result.nativeAfterRevoke, /not attached/u);
  assert.match(result.brokerAfterDisposal, /disposed/u);
  assert.deepEqual(result.errors, []);
  for (const method of ['attach', 'detach'])
    assert.equal(
      result.trace.filter((entry) => entry.method === method && entry.status === 'fulfilled')
        .length,
      1,
    );
  for (const method of ['Runtime.enable', 'Runtime.disable'])
    assert.equal(
      result.trace.filter((entry) => entry.method === method && entry.status === 'fulfilled')
        .length,
      2,
    );
  assert.deepEqual(
    result.trace.filter((entry) => entry.status === 'rejected').map((entry) => entry.method),
    ['Runtime.evaluate'],
  );
}

export function assertFirefoxReceipt(receipt: unknown): void {
  const response = z
    .object({
      passed: z.literal(true),
      result: z.object({
        host: z.object({
          status: z.literal('unavailable'),
          reason: z.literal('unsupported-browser'),
        }),
        capability: z.literal('unavailable'),
        installedServices: z.literal(0),
        nativeDebuggerAvailable: z.literal(false),
        plugin: z.object({
          contributions: z.array(
            z.object({ status: z.literal('waiting'), reason: z.literal('dependency-unavailable') }),
          ),
        }),
        actionError: z.string(),
      }),
    })
    .parse(receipt);
  assert.equal(response.result.plugin.contributions.length, 1);
  assert.match(response.result.actionError, /unavailable/iu);
}
