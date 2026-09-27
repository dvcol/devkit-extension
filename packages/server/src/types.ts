import type {
  ActionDescriptor,
  ActionInvocationRequest,
  CapabilityDescriptor,
  CapabilityResolution,
  CapabilityResolutionRequest,
  ContributionKindDescriptor,
  ContributionKindInstaller,
  DefinitionInstallationApi,
  InstallationResult,
  OperationValue,
  PluginDefinition,
  ProviderDescriptor,
  ProviderCatalog,
  RuntimeDiagnostic,
  ServiceDeclaration,
} from '@devkit/core';

export interface ServerComposition<Strict extends boolean = true> {
  readonly providerId: string;
  readonly strict?: Strict;
  readonly services?: readonly ServiceDeclaration[];
  readonly plugins?: readonly PluginDefinition[];
  readonly kinds?: readonly ContributionKindInstaller<ContributionKindDescriptor>[];
  /** This local sink may receive native causes; they are not portable diagnostic data. */
  readonly report?: (diagnostic: RuntimeDiagnostic, cause?: unknown) => void;
}

/** Local integration only. This handle does not publish discovery or create a transport. */
export interface ServerProviderHandle<Strict extends boolean = true> {
  readonly provider: ProviderDescriptor;
  readonly catalog: ProviderCatalog;
  readonly services: DefinitionInstallationApi<ServiceDeclaration, Strict>;
  readonly plugins: DefinitionInstallationApi<PluginDefinition, Strict>;
  readonly startup: {
    readonly services: readonly InstallationResult<Strict>[];
    readonly plugins: readonly InstallationResult<Strict>[];
  };
  resolve<Capability extends CapabilityDescriptor>(
    request: CapabilityResolutionRequest<Capability>,
  ): Promise<CapabilityResolution<Capability>>;
  invoke<Action extends ActionDescriptor>(
    request: ActionInvocationRequest<Action>,
  ): Promise<OperationValue<Action['operation']>>;
  /** Dispose adapter-owned contributions. The caller retains ownership of its native host. */
  dispose(): Promise<void>;
}
