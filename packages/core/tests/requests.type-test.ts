/** Compile-only checks for request inference and operation/payload correlation. */
import { z } from 'zod';
import { defineActionContract, defineCapability, defineOperation } from '../src/index.js';
import type { ActionClient, CapabilityClient, CapabilityInvocationRequest } from '../src/index.js';

const capability = defineCapability({
  id: 'example.requests',
  version: 1,
  operations: {
    read: defineOperation({
      input: z.object({ target: z.object({ resource: z.string(), revision: z.number() }) }),
      output: z.string(),
    }),
    count: defineOperation({ input: z.number(), output: z.number() }),
  },
});
const action = defineActionContract({
  id: 'example.read',
  version: 1,
  operation: capability.operations.read,
});
const input = { target: { resource: 'example', revision: 1 } };

function selectedRequest(
  operation: 'read' | 'count',
): CapabilityInvocationRequest<typeof capability> {
  if (operation === 'read') return { capability, operation, input };
  return { capability, operation, input: 2 };
}

export async function checkRequests(
  capabilities: CapabilityClient,
  actions: ActionClient,
  operation: 'read' | 'count',
  signal: AbortSignal,
): Promise<void> {
  (await capabilities.invoke({ capability, operation: 'read', input, signal })) satisfies string;
  (await capabilities.invoke({ capability, operation: 'count', input: 2 })) satisfies number;
  (await actions.invoke({ action, input, signal })) satisfies string;
  (await capabilities.invoke(selectedRequest(operation))) satisfies string | number;

  // @ts-expect-error A dynamic operation name cannot break payload correlation.
  await capabilities.invoke({ capability, operation, input: 2 });
  // @ts-expect-error Resource fields required by the operation schema remain mandatory.
  await capabilities.invoke({ capability, operation: 'read', input: {} });
  // @ts-expect-error The SDK has no universal target option.
  await capabilities.invoke({ capability, operation: 'count', input: 2, target: input.target });
  // @ts-expect-error Another operation's payload cannot widen the selected operation.
  await capabilities.invoke({ capability, operation: 'read', input: 2 });
  // @ts-expect-error An unknown operation cannot widen the imported capability.
  await capabilities.invoke({ capability, operation: 'missing', input: 2 });
  // @ts-expect-error The selected operation's output remains exact.
  (await capabilities.invoke({ capability, operation: 'count', input: 2 })) satisfies string;
  // @ts-expect-error Resource reference shape is defined by this action, not a generic string generation.
  await actions.invoke({ action, input: { target: { resource: 'example', revision: 'one' } } });
  // @ts-expect-error The payload cannot widen an imported action contract.
  await actions.invoke({ action, input: 2 });
  // @ts-expect-error Signals belong to the request, not an untyped options bag.
  await actions.invoke({ action, input, signal: 'cancel' });
  // @ts-expect-error The positional capability invocation API was removed.
  await capabilities.invoke(capability, 'count', 2);
  // @ts-expect-error The positional action invocation API was removed.
  await actions.invoke(action, input, { signal });
  // @ts-expect-error Resolution takes a scoped request object.
  await capabilities.resolve(capability);
}
