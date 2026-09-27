/** Compile-only checks for broadcast inference and its separate recipient selection. */
import { z } from 'zod';
import { defineActionContract, defineCapability, defineOperation } from '../src/index.js';
import type {
  ActionClient,
  CapabilityClient,
  BroadcastOutcome,
  RoutingCandidate,
} from '../src/index.js';

const capability = defineCapability({
  id: 'example.broadcast',
  version: 1,
  operations: {
    read: defineOperation({ input: z.string(), output: z.string() }),
    count: defineOperation({ input: z.number(), output: z.number() }),
  },
});
const action = defineActionContract({
  id: 'example.broadcast.read',
  version: 1,
  operation: capability.operations.read,
  routing: ({ candidates, signal, input }) => {
    candidates satisfies readonly RoutingCandidate[];
    signal satisfies AbortSignal;
    input satisfies unknown;
    return { realm: 'devserver' };
  },
});
const selection = [{ realm: 'devserver', provider: 'A' }] as const;

export async function requests(
  capabilities: CapabilityClient,
  actions: ActionClient,
): Promise<void> {
  (await actions.broadcast({
    action,
    input: 'value',
    selection,
  })) satisfies readonly BroadcastOutcome<string>[];
  (await capabilities.broadcast({
    capability,
    operation: 'count',
    input: 2,
    selection,
  })) satisfies readonly BroadcastOutcome<number>[];
  // @ts-expect-error Broadcast does not inherit action routing in place of selection.
  await actions.broadcast({ action, input: 'value' });
  // @ts-expect-error Selection must not be empty.
  await actions.broadcast({ action, input: 'value', selection: [] });
  await actions.broadcast({
    action,
    input: 'value',
    selection,
    // @ts-expect-error Broadcast has no ordinary routing option.
    routing: { realm: 'devserver' },
  });
  // @ts-expect-error Broadcast action inputs preserve their contract.
  await actions.broadcast({ action, input: 2, selection });
  // @ts-expect-error Broadcast selection cannot contain a provider without its realm.
  await capabilities.broadcast({
    capability,
    operation: 'read',
    input: 'value',
    selection: [{ provider: 'A' }],
  });
  // @ts-expect-error The operation name preserves payload correlation.
  await capabilities.broadcast({ capability, operation: 'count', input: 'value', selection });
  // @ts-expect-error Broadcast has no universal target option.
  await capabilities.broadcast({
    capability,
    operation: 'count',
    input: 2,
    selection,
    target: { id: 'example' },
  });
}
