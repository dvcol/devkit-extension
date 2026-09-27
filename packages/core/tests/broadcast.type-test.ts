/** Compile-only checks for broadcast inference and its separate recipient selection. */
import { z } from 'zod';
import { defineActionContract, defineCapability, defineOperation } from '../src/index.js';
import type {
  ActionClient,
  CapabilityClient,
  BroadcastOutcome,
  RoutingCandidate,
  TargetReference,
} from '../src/index.js';

const capability = defineCapability({
  id: 'example.broadcast',
  version: 1,
  operations: {
    read: defineOperation({ input: z.string(), output: z.string(), target: 'required' }),
    count: defineOperation({ input: z.number(), output: z.number(), target: 'none' }),
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
  target: TargetReference,
): Promise<void> {
  (await actions.broadcast({
    action,
    input: 'value',
    target,
    selection,
  })) satisfies readonly BroadcastOutcome<string>[];
  (await capabilities.broadcast({
    capability,
    operation: 'count',
    input: 2,
    selection,
  })) satisfies readonly BroadcastOutcome<number>[];
  // @ts-expect-error Broadcast does not inherit action routing in place of selection.
  await actions.broadcast({ action, input: 'value', target });
  // @ts-expect-error Selection must not be empty.
  await actions.broadcast({ action, input: 'value', target, selection: [] });
  await actions.broadcast({
    action,
    input: 'value',
    target,
    selection,
    // @ts-expect-error Broadcast has no ordinary routing option.
    routing: { realm: 'devserver' },
  });
  // @ts-expect-error A broadcast action still requires its execution target.
  await actions.broadcast({ action, input: 'value', selection });
  // @ts-expect-error A broadcast capability still requires its execution target.
  await capabilities.broadcast({ capability, operation: 'read', input: 'value', selection });
  // @ts-expect-error The operation name preserves payload correlation.
  await capabilities.broadcast({ capability, operation: 'count', input: 'value', selection });
  // @ts-expect-error Targetless operations reject target metadata.
  await capabilities.broadcast({ capability, operation: 'count', input: 2, selection, target });
}
