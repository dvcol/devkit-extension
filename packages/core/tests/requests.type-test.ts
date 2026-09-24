/** Compile-only checks for request inference and operation/payload correlation. */
import { z } from 'zod';
import { defineActionContract, defineCapability, defineOperation } from '../src/index.js';
import type {
  ActionClient,
  CapabilityClient,
  CapabilityInvocationRequest,
  TargetReference,
} from '../src/index.js';

const capability = defineCapability({
  id: 'example.requests',
  version: 1,
  operations: {
    read: defineOperation({ input: z.string(), output: z.string(), target: 'required' }),
    count: defineOperation({ input: z.number(), output: z.number(), target: 'none' }),
  },
});
const action = defineActionContract({
  id: 'example.read',
  version: 1,
  operation: capability.operations.read,
});

function selectedRequest(
  operation: 'read' | 'count',
  target: TargetReference,
): CapabilityInvocationRequest<typeof capability> {
  if (operation === 'read') return { capability, operation, input: 'value', target };
  return { capability, operation, input: 2 };
}

export async function checkRequests(
  capabilities: CapabilityClient,
  actions: ActionClient,
  target: TargetReference,
  operation: 'read' | 'count',
  signal: AbortSignal,
): Promise<void> {
  (await capabilities.invoke({
    capability,
    operation: 'read',
    input: 'value',
    target,
    signal,
  })) satisfies string;
  (await capabilities.invoke({ capability, operation: 'count', input: 2 })) satisfies number;
  (await actions.invoke({ action, input: 'value', target, signal })) satisfies string;
  const request = selectedRequest(operation, target);
  (await capabilities.invoke(request)) satisfies string | number;

  // @ts-expect-error A dynamic operation name cannot break payload/target correlation.
  await capabilities.invoke({ capability, operation, input: 2 });
  // @ts-expect-error Required execution targets remain mandatory.
  await capabilities.invoke({ capability, operation: 'read', input: 'value' });
  // @ts-expect-error Targetless operations reject execution targets.
  await capabilities.invoke({ capability, operation: 'count', input: 2, target });
  // @ts-expect-error Another operation's payload cannot widen the selected operation.
  await capabilities.invoke({ capability, operation: 'read', input: 2, target });
  // @ts-expect-error An unknown operation cannot widen the imported capability.
  await capabilities.invoke({ capability, operation: 'missing', input: 2 });
  // @ts-expect-error The selected operation's output remains exact.
  (await capabilities.invoke({ capability, operation: 'count', input: 2 })) satisfies string;
  // @ts-expect-error Actions preserve required execution targets.
  await actions.invoke({ action, input: 'value' });
  // @ts-expect-error The payload cannot widen an imported action contract.
  await actions.invoke({ action, input: 2, target });
  // @ts-expect-error Signals belong to the request, not an untyped options bag.
  await actions.invoke({ action, input: 'value', target, signal: 'cancel' });
  // @ts-expect-error The positional capability invocation API was removed.
  await capabilities.invoke(capability, 'count', 2);
  // @ts-expect-error The positional action invocation API was removed.
  await actions.invoke(action, 'value', { target });
  // @ts-expect-error Resolution now takes a scoped request object.
  await capabilities.resolve(capability);
}
