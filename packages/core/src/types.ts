import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { RoutingPolicy } from './routing.js';

export type Awaitable<Value> = Value | Promise<Value>;
export type Unsubscribe = () => void;

declare const nativeContextValue: unique symbol;

/** Constrain a realm, optionally pinning a provider within that realm. Identifiers are not coerced. */
export interface RouteSelector {
  readonly realm: string;
  readonly provider?: string;
}

/** One selector, or an ordered non-empty fallback list for a single invocation. */
export type RoutingDirective = RouteSelector | readonly [RouteSelector, ...RouteSelector[]];

export interface RealmDescriptor<Identifier extends string = string> {
  readonly id: Identifier;
}

export interface ExecutionDescriptor<Identifier extends string = string> {
  readonly id: Identifier;
}

export interface ProviderDescriptor {
  /** Stable provider identity supplied by host configuration. */
  readonly id: string;
  /** Opaque adapter-issued identity for one backend lifetime; stable across client HMR and reconnects. */
  readonly incarnation: string;
  readonly realm: RealmDescriptor;
}

export interface NativeContextDescriptor<Value> {
  readonly id: string;
  readonly [nativeContextValue]?: Value;
}

export interface NativeContextAccess {
  get<Value>(descriptor: NativeContextDescriptor<Value>): Value | undefined;
}

export interface ContextMetadata {
  readonly provider: ProviderDescriptor;
  readonly execution: ExecutionDescriptor;
}

export type BindingContext =
  | (ContextMetadata & { readonly access: 'local'; readonly native: NativeContextAccess })
  | (ContextMetadata & { readonly access: 'remote' });

export interface InvocationOptions {
  readonly signal?: AbortSignal;
}

export interface RoutedInvocationOptions extends InvocationOptions {
  readonly routing?: RoutingPolicy;
}

export interface OperationDefinition {
  readonly input: StandardSchemaV1;
  readonly output: StandardSchemaV1;
}

export type OperationInput<Definition extends OperationDefinition> = StandardSchemaV1.InferInput<
  Definition['input']
>;
export type OperationValue<Definition extends OperationDefinition> = StandardSchemaV1.InferInput<
  Definition['output']
>;

export type OperationArguments<
  Definition extends OperationDefinition,
  Options extends InvocationOptions = InvocationOptions,
> = [input: OperationInput<Definition>, options?: Options];

export interface OperationContext extends ContextMetadata {
  readonly signal: AbortSignal;
  readonly native: NativeContextAccess;
}

export interface CapabilityDescriptor<
  Operations extends Readonly<Record<string, OperationDefinition>> = Readonly<
    Record<string, OperationDefinition>
  >,
> {
  readonly kind: 'capability';
  readonly id: string;
  readonly version: number;
  readonly operations: Operations;
}

export type CapabilityApi<Capability extends CapabilityDescriptor> = {
  readonly [OperationName in keyof Capability['operations']]: (
    ...invocationArguments: OperationArguments<Capability['operations'][OperationName]>
  ) => Promise<OperationValue<Capability['operations'][OperationName]>>;
};

export type CapabilityImplementation<Capability extends CapabilityDescriptor> = {
  readonly [OperationName in keyof Capability['operations']]: (
    input: OperationInput<Capability['operations'][OperationName]>,
    context: OperationContext,
  ) => Awaitable<OperationValue<Capability['operations'][OperationName]>>;
};

export interface CapabilityBinding<Capability extends CapabilityDescriptor> {
  readonly api: CapabilityApi<Capability>;
  readonly context: BindingContext;
}

export type CapabilityRequirements = Readonly<Record<string, CapabilityDescriptor>>;
export type RequirementBindings<Requirements extends CapabilityRequirements> = {
  readonly [RequirementName in keyof Requirements]: CapabilityBinding<
    Requirements[RequirementName]
  >;
};

export interface ActivationScope {
  readonly signal: AbortSignal;
  onDispose(cleanup: () => Awaitable<void>): void;
}

export interface SetupContext<Requirements extends CapabilityRequirements> extends ContextMetadata {
  readonly native: NativeContextAccess;
  readonly scope: ActivationScope;
  readonly services: RequirementBindings<Requirements>;
}

export interface ContributionDeclaration<Kind extends string = string> {
  readonly kind: Kind;
  readonly id: string;
  readonly execution: ExecutionDescriptor;
}

export interface ServiceDeclaration extends ContributionDeclaration<'service'> {
  readonly capability: CapabilityDescriptor;
  readonly requires: CapabilityRequirements;
  readonly setup: (...setupArguments: never[]) => unknown;
}

export interface ServiceDefinition<
  Capability extends CapabilityDescriptor,
  Requirements extends CapabilityRequirements,
> extends ServiceDeclaration {
  readonly capability: Capability;
  readonly requires: Requirements;
  setup(context: SetupContext<Requirements>): Awaitable<CapabilityImplementation<Capability>>;
}

export interface ViewDeclaration extends ContributionDeclaration<'view'> {
  readonly requires: CapabilityRequirements;
  readonly setup: (...setupArguments: never[]) => unknown;
}

/** Setup owns native publication through its scope; returned resources are not adopted. */
export interface ViewDefinition<
  Requirements extends CapabilityRequirements,
> extends ViewDeclaration {
  readonly requires: Requirements;
  setup(context: SetupContext<Requirements>): Awaitable<void>;
}

export interface ScriptDeclaration extends ContributionDeclaration<'script'> {
  readonly requires: CapabilityRequirements;
  readonly setup: (...setupArguments: never[]) => unknown;
}

/** Setup owns native registration through its scope; native tooling packages executable code. */
export interface ScriptDefinition<
  Requirements extends CapabilityRequirements,
> extends ScriptDeclaration {
  readonly requires: Requirements;
  setup(context: SetupContext<Requirements>): Awaitable<void>;
}

export interface TransformDeclaration extends ContributionDeclaration<'transform'> {
  readonly requires: CapabilityRequirements;
  readonly setup: (...setupArguments: never[]) => unknown;
}

/** Setup owns native transformation through its scope; native APIs define stages and options. */
export interface TransformDefinition<
  Requirements extends CapabilityRequirements,
> extends TransformDeclaration {
  readonly requires: Requirements;
  setup(context: SetupContext<Requirements>): Awaitable<void>;
}

export interface ActionDescriptor<Operation extends OperationDefinition = OperationDefinition> {
  readonly kind: 'action-contract';
  readonly id: string;
  readonly version: number;
  readonly operation: Operation;
  /** Client-visible default; an invocation's explicit routing replaces this entire policy. */
  readonly routing?: RoutingPolicy;
}

export interface ActionDeclaration extends ContributionDeclaration<'action'> {
  readonly contract: ActionDescriptor;
  readonly requires: CapabilityRequirements;
  readonly handler: (...handlerArguments: never[]) => unknown;
}

export interface ActionDefinition<
  Action extends ActionDescriptor,
  Requirements extends CapabilityRequirements,
> extends ActionDeclaration {
  readonly contract: Action;
  readonly requires: Requirements;
  handler(
    context: OperationContext & {
      readonly input: OperationInput<Action['operation']>;
      readonly services: RequirementBindings<Requirements>;
    },
  ): Awaitable<OperationValue<Action['operation']>>;
}

export interface ContributionKindDescriptor<
  PayloadSchema extends StandardSchemaV1 = StandardSchemaV1,
> {
  readonly id: string;
  readonly schema: PayloadSchema;
}

export interface ExtensionDefinition<
  Kind extends ContributionKindDescriptor = ContributionKindDescriptor,
> extends ContributionDeclaration<'extension'> {
  readonly descriptor: Kind;
  readonly payload: StandardSchemaV1.InferInput<Kind['schema']>;
}

export interface PluginInput {
  readonly id: string;
  readonly services?: readonly ServiceDeclaration[];
  readonly actions?: readonly ActionDeclaration[];
  readonly views?: readonly ViewDeclaration[];
  readonly transforms?: readonly TransformDeclaration[];
  readonly scripts?: readonly ScriptDeclaration[];
  readonly extensions?: readonly ExtensionDefinition[];
}

export type PluginDefinition<Input extends PluginInput = PluginInput> = Readonly<Input> & {
  readonly kind: 'plugin';
};
