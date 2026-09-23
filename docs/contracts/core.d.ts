import type { StandardSchemaV1 } from '@standard-schema/spec';

/** Declaration contract only. No runtime implementation is supplied by this file. */
export type Awaitable<Value> = Value | Promise<Value>;
export type Unsubscribe = () => void;
export type TargetRequirement = 'required' | 'none';

declare const nativeContextValue: unique symbol;
declare const routingDirectiveType: unique symbol;

/** Constructed by the routing package; selection semantics belong to its contract. */
export interface RoutingDirective {
  readonly [routingDirectiveType]: true;
}

/** Validated adapter-issued identity; native tab/document handles are not transported. */
export interface TargetReference {
  readonly kind: string;
  readonly id: string;
  readonly generation: string;
}

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
  readonly routing?: RoutingDirective;
}

export interface OperationDefinition {
  readonly input: StandardSchemaV1;
  readonly output: StandardSchemaV1;
  readonly target: TargetRequirement;
}

export type OperationInput<Definition extends OperationDefinition> = StandardSchemaV1.InferInput<Definition['input']>;
export type OperationValue<Definition extends OperationDefinition> = StandardSchemaV1.InferInput<Definition['output']>;

export type OperationArguments<Definition extends OperationDefinition, Options extends InvocationOptions = InvocationOptions> = Definition['target'] extends 'required'
  ? [input: OperationInput<Definition>, options: Options & { readonly target: TargetReference }]
  : [input: OperationInput<Definition>, options?: Options & { readonly target?: never }];

export type OperationContext<Definition extends OperationDefinition> = ContextMetadata & {
  readonly signal: AbortSignal;
  readonly native: NativeContextAccess;
} & (Definition['target'] extends 'required' ? { readonly target: TargetReference } : { readonly target?: never });

export interface CapabilityDescriptor<Operations extends Readonly<Record<string, OperationDefinition>> = Readonly<Record<string, OperationDefinition>>> {
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
    context: OperationContext<Capability['operations'][OperationName]>,
  ) => Awaitable<OperationValue<Capability['operations'][OperationName]>>;
};

export interface CapabilityBinding<Capability extends CapabilityDescriptor> {
  readonly api: CapabilityApi<Capability>;
  readonly context: BindingContext;
}

export type CapabilityRequirements = Readonly<Record<string, CapabilityDescriptor>>;
export type RequirementBindings<Requirements extends CapabilityRequirements> = {
  readonly [RequirementName in keyof Requirements]: CapabilityBinding<Requirements[RequirementName]>;
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

export interface ServiceDefinition<Capability extends CapabilityDescriptor, Requirements extends CapabilityRequirements> extends ServiceDeclaration {
  readonly capability: Capability;
  readonly requires: Requirements;
  setup(context: SetupContext<Requirements>): Awaitable<CapabilityImplementation<Capability>>;
}

export interface ActionDescriptor<Operation extends OperationDefinition = OperationDefinition> {
  readonly kind: 'action-contract';
  readonly id: string;
  readonly version: number;
  readonly operation: Operation;
}

export interface ActionDeclaration extends ContributionDeclaration<'action'> {
  readonly contract: ActionDescriptor;
  readonly requires: CapabilityRequirements;
  readonly handler: (...handlerArguments: never[]) => unknown;
}

export interface ActionDefinition<Action extends ActionDescriptor, Requirements extends CapabilityRequirements> extends ActionDeclaration {
  readonly contract: Action;
  readonly requires: Requirements;
  handler(context: OperationContext<Action['operation']> & {
    readonly input: OperationInput<Action['operation']>;
    readonly services: RequirementBindings<Requirements>;
  }): Awaitable<OperationValue<Action['operation']>>;
}

export interface ContributionKindDescriptor<PayloadSchema extends StandardSchemaV1 = StandardSchemaV1> {
  readonly id: string;
  readonly schema: PayloadSchema;
}

export interface ExtensionDefinition<Kind extends ContributionKindDescriptor = ContributionKindDescriptor> extends ContributionDeclaration<'extension'> {
  readonly descriptor: Kind;
  readonly payload: StandardSchemaV1.InferInput<Kind['schema']>;
}

export interface PluginInput {
  readonly id: string;
  readonly services?: readonly ServiceDeclaration[];
  readonly actions?: readonly ActionDeclaration[];
  readonly views?: readonly ContributionDeclaration<'view'>[];
  readonly transforms?: readonly ContributionDeclaration<'transform'>[];
  readonly scripts?: readonly ContributionDeclaration<'script'>[];
  readonly extensions?: readonly ExtensionDefinition[];
}

export type PluginDefinition<Input extends PluginInput = PluginInput> = Readonly<Input> & { readonly kind: 'plugin' };

export declare function defineRealm<const Identifier extends string>(definition: RealmDescriptor<Identifier>): RealmDescriptor<Identifier>;
export declare function defineExecution<const Identifier extends string>(definition: ExecutionDescriptor<Identifier>): ExecutionDescriptor<Identifier>;
export declare function defineNativeContext<Value>(definition: { readonly id: string }): NativeContextDescriptor<Value>;
export declare function defineOperation<const Definition extends OperationDefinition>(definition: Definition): Definition;
export declare function defineCapability<const Definition extends Omit<CapabilityDescriptor, 'kind'>>(definition: Definition): Readonly<Definition> & { readonly kind: 'capability' };
export declare function defineAction<const Definition extends Omit<ActionDescriptor, 'kind'>>(definition: Definition): Readonly<Definition> & { readonly kind: 'action-contract' };
export declare function defineService<Capability extends CapabilityDescriptor, const Requirements extends CapabilityRequirements = Record<never, never>>(
  capability: Capability,
  definition: {
    readonly id: string;
    readonly execution: ExecutionDescriptor;
    readonly requires?: Requirements;
    setup(context: SetupContext<Requirements>): Awaitable<CapabilityImplementation<Capability>>;
  },
): ServiceDefinition<Capability, Requirements>;
export declare function defineActionContribution<Action extends ActionDescriptor, const Requirements extends CapabilityRequirements = Record<never, never>>(
  contract: Action,
  definition: {
    readonly id: string;
    readonly execution: ExecutionDescriptor;
    readonly requires?: Requirements;
    handler: ActionDefinition<Action, Requirements>['handler'];
  },
): ActionDefinition<Action, Requirements>;
export declare function defineContributionKind<const Kind extends ContributionKindDescriptor>(definition: Kind): Kind;
export declare function defineExtension<const Kind extends ContributionKindDescriptor>(
  descriptor: Kind,
  definition: { readonly id: string; readonly execution: ExecutionDescriptor; readonly payload: StandardSchemaV1.InferInput<Kind['schema']> },
): ExtensionDefinition<Kind>;
export declare function definePlugin<const Input extends PluginInput>(definition: Input & Record<Exclude<keyof Input, keyof PluginInput>, never>): PluginDefinition<Input>;

export type AvailabilityReason = 'unsupported' | 'wrong-execution' | 'missing-permission' | 'target-unavailable' | 'restricted-target' | 'stale-target' | 'disconnected' | 'incompatible-contract' | 'dependency-unavailable';
export interface RuntimeDiagnostic {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly providerId: string;
  readonly pluginId?: string;
  readonly contributionId?: string;
  readonly phase: 'admission' | 'setup' | 'call' | 'cleanup' | 'transport';
}
export interface OperationError extends Error {
  readonly code: string;
  readonly diagnostic: RuntimeDiagnostic;
}
export declare function isOperationError(error: unknown): error is OperationError;

export type CapabilityResolution<Capability extends CapabilityDescriptor> =
  | { readonly status: 'available'; readonly binding: CapabilityBinding<Capability> }
  | { readonly status: 'unavailable'; readonly reason: AvailabilityReason; readonly diagnostic?: RuntimeDiagnostic };

export interface ContributionSnapshot {
  readonly id: string;
  readonly kind: string;
  readonly generation: number;
  readonly enabled: boolean;
  readonly status: 'waiting' | 'starting' | 'active' | 'stopping' | 'disabled' | 'failed' | 'cleanup-blocked' | 'disposed';
  readonly reason?: AvailabilityReason;
  readonly diagnostics: readonly RuntimeDiagnostic[];
}
export interface InstallationSnapshot {
  readonly id: string;
  readonly status: 'ready' | 'partial' | 'inactive' | 'disposing' | 'cleanup-blocked' | 'disposed';
  readonly contributions: readonly ContributionSnapshot[];
  readonly diagnostics: readonly RuntimeDiagnostic[];
}
export interface InstallationHandle {
  snapshot(): InstallationSnapshot;
  subscribe(listener: (snapshot: InstallationSnapshot) => void): Unsubscribe;
  enable(): Promise<InstallationSnapshot>;
  disable(): Promise<InstallationSnapshot>;
  retry(contributionId: string): Promise<InstallationSnapshot>;
  dispose(): Promise<void>;
}
export type InstallationResult =
  | { readonly status: 'admitted'; readonly handle: InstallationHandle }
  | { readonly status: 'skipped'; readonly diagnostic: RuntimeDiagnostic };

export interface DefinitionInstallationApi<Definition> {
  install(definition: Definition): Promise<InstallationResult>;
  replace(handle: InstallationHandle, definition: Definition): Promise<InstallationResult>;
}
export interface ContributionKindInstaller<Kind extends ContributionKindDescriptor> {
  readonly descriptor: Kind;
  activate(definition: ExtensionDefinition<Kind>, context: SetupContext<Record<never, never>>): Awaitable<void>;
}

export interface CapabilityClient {
  resolve<Capability extends CapabilityDescriptor>(
    capability: Capability,
    options?: RoutedInvocationOptions & { readonly target?: TargetReference },
  ): Promise<CapabilityResolution<Capability>>;
  invoke<Capability extends CapabilityDescriptor, OperationName extends keyof Capability['operations']>(
    capability: Capability,
    operation: OperationName,
    ...invocationArguments: OperationArguments<Capability['operations'][OperationName], RoutedInvocationOptions>
  ): Promise<OperationValue<Capability['operations'][OperationName]>>;
}

export interface ActionClient {
  invoke<Action extends ActionDescriptor>(
    action: Action,
    ...invocationArguments: OperationArguments<Action['operation'], RoutedInvocationOptions>
  ): Promise<OperationValue<Action['operation']>>;
}
