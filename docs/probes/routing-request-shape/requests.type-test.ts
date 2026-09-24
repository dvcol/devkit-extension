import { defineCapability } from '/Users/dinh-van.colomban/Workspace/private/devkit-extension/packages/core/dist/index.js';
import type {
  ActionDescriptor,
  CapabilityDescriptor,
  OperationDefinition,
  OperationInput,
  OperationValue,
  ProviderDescriptor,
  RoutedInvocationOptions,
  TargetReference,
} from '/Users/dinh-van.colomban/Workspace/private/devkit-extension/packages/core/dist/index.js';
import {
  counterCapability,
  increaseCounterAction,
} from '/Users/dinh-van.colomban/Workspace/private/devkit-extension/examples/contribution/dist/index.js';

type RequestContext<Operation extends OperationDefinition> = RoutedInvocationOptions &
  (Operation['target'] extends 'required'
    ? { readonly target: TargetReference }
    : { readonly target?: never });

type CapabilityRequest<
  Capability extends CapabilityDescriptor,
  OperationName extends keyof Capability['operations'],
> = {
  readonly capability: Capability;
  readonly operation: OperationName;
  readonly input: OperationInput<NoInfer<Capability['operations'][OperationName]>>;
} & RequestContext<Capability['operations'][OperationName]>;

type ActionRequest<Action extends ActionDescriptor> = {
  readonly action: Action;
  readonly input: OperationInput<NoInfer<Action['operation']>>;
} & RequestContext<Action['operation']>;

type Outcome<Value> =
  | { readonly provider: ProviderDescriptor; readonly status: 'fulfilled'; readonly value: Value }
  | { readonly provider: ProviderDescriptor; readonly status: 'rejected'; readonly error: unknown };

declare function invokeCapability<
  Capability extends CapabilityDescriptor,
  const OperationName extends keyof Capability['operations'],
>(request: CapabilityRequest<Capability, OperationName>): Promise<OperationValue<Capability['operations'][OperationName]>>;

declare function broadcastCapability<
  Capability extends CapabilityDescriptor,
  const OperationName extends keyof Capability['operations'],
>(request: CapabilityRequest<Capability, OperationName>): Promise<readonly Outcome<OperationValue<Capability['operations'][OperationName]>>[]>;

declare function invokeAction<Action extends ActionDescriptor>(request: ActionRequest<Action>): Promise<OperationValue<Action['operation']>>;

const target: TargetReference = { kind: 'document', id: 'tab:1', generation: 'document:1' };
const targetedCapability = defineCapability({
  id: 'example.targeted',
  version: 1,
  operations: {
    increase: { ...counterCapability.operations.increase, target: 'required' },
  },
});

export const value: Promise<number> = invokeCapability({ capability: counterCapability, operation: 'increase', input: { amount: 2 } });
export const targetedValue: Promise<number> = invokeCapability({ capability: targetedCapability, operation: 'increase', input: { amount: 2 }, target });
export const actionValue: Promise<number> = invokeAction({ action: increaseCounterAction, input: { amount: 2 } });
export const outcomes: Promise<readonly Outcome<number>[]> = broadcastCapability({ capability: counterCapability, operation: 'increase', input: { amount: 2 } });

// @ts-expect-error Operation names come from the imported capability descriptor.
invokeCapability({ capability: counterCapability, operation: 'missing', input: {} });
// @ts-expect-error Business input is inferred from the selected operation schema.
invokeCapability({ capability: counterCapability, operation: 'increase', input: { amount: 'two' } });
// @ts-expect-error The required amount is not optional.
invokeCapability({ capability: counterCapability, operation: 'increase', input: {} });
// @ts-expect-error A target-required operation cannot omit target identity/generation.
invokeCapability({ capability: targetedCapability, operation: 'increase', input: { amount: 2 } });
// @ts-expect-error A targetless operation cannot receive a target.
invokeCapability({ capability: counterCapability, operation: 'increase', input: { amount: 2 }, target });
// @ts-expect-error Action input retains the descriptor schema.
invokeAction({ action: increaseCounterAction, input: { amount: 'two' } });
// @ts-expect-error Broadcast preserves required-target typing.
broadcastCapability({ capability: targetedCapability, operation: 'increase', input: { amount: 2 } });
// @ts-expect-error Operation return type stays numeric.
export const wrongValue: Promise<string> = invokeCapability({ capability: counterCapability, operation: 'increase', input: { amount: 2 } });
