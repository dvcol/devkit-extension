import type {
  Awaitable,
  CapabilityBinding,
  CapabilityDescriptor,
  ContributionKindDescriptor,
  ExtensionDefinition,
  ActionDescriptor,
  OperationArguments,
  OperationValue,
  RoutedInvocationOptions,
  SetupContext,
  TargetReference,
  Unsubscribe,
} from './types.js';

export type AvailabilityReason =
  | 'unsupported'
  | 'wrong-execution'
  | 'missing-permission'
  | 'target-unavailable'
  | 'restricted-target'
  | 'stale-target'
  | 'disconnected'
  | 'incompatible-contract'
  | 'dependency-unavailable';
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

export type CapabilityResolution<Capability extends CapabilityDescriptor> =
  | { readonly status: 'available'; readonly binding: CapabilityBinding<Capability> }
  | {
      readonly status: 'unavailable';
      readonly reason: AvailabilityReason;
      readonly diagnostic?: RuntimeDiagnostic;
    };

export interface ContributionSnapshot {
  readonly id: string;
  readonly kind: string;
  readonly generation: number;
  readonly enabled: boolean;
  readonly status:
    | 'waiting'
    | 'starting'
    | 'active'
    | 'stopping'
    | 'disabled'
    | 'failed'
    | 'cleanup-blocked'
    | 'disposed';
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
  activate(
    definition: ExtensionDefinition<Kind>,
    context: SetupContext<Record<never, never>>,
  ): Awaitable<void>;
}

export interface CapabilityClient {
  resolve<Capability extends CapabilityDescriptor>(
    capability: Capability,
    options?: RoutedInvocationOptions & { readonly target?: TargetReference },
  ): Promise<CapabilityResolution<Capability>>;
  invoke<
    Capability extends CapabilityDescriptor,
    OperationName extends keyof Capability['operations'],
  >(
    capability: Capability,
    operation: OperationName,
    ...invocationArguments: OperationArguments<
      Capability['operations'][OperationName],
      RoutedInvocationOptions
    >
  ): Promise<OperationValue<Capability['operations'][OperationName]>>;
}

export interface ActionClient {
  invoke<Action extends ActionDescriptor>(
    action: Action,
    ...invocationArguments: OperationArguments<Action['operation'], RoutedInvocationOptions>
  ): Promise<OperationValue<Action['operation']>>;
}
