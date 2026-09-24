import type {
  ActionDescriptor,
  CapabilityDescriptor,
  InvocationOptions,
  OperationDefinition,
  OperationInput,
  TargetReference,
} from './types.js';

/** The operation descriptor alone determines the payload and required execution target. */
export type OperationRequest<
  Definition extends OperationDefinition,
  Options extends InvocationOptions = InvocationOptions,
> = {
  readonly input: OperationInput<Definition>;
} & Options &
  (Definition['target'] extends 'required'
    ? { readonly target: TargetReference }
    : { readonly target?: never });

/** Preserve operation/payload/target correlation when several operation names are possible. */
export type CapabilityInvocationRequest<
  Capability extends CapabilityDescriptor,
  OperationName extends keyof Capability['operations'] = keyof Capability['operations'],
  Options extends InvocationOptions = InvocationOptions,
> = {
  readonly [Name in OperationName]: {
    readonly capability: Capability;
    readonly operation: Name;
  } & OperationRequest<NoInfer<Capability['operations'][Name]>, Options>;
}[OperationName];

export type ActionInvocationRequest<
  Action extends ActionDescriptor,
  Options extends InvocationOptions = InvocationOptions,
> = {
  readonly action: Action;
} & OperationRequest<NoInfer<Action['operation']>, Options>;

export interface CapabilityResolutionRequest<Capability extends CapabilityDescriptor> {
  readonly capability: Capability;
}
