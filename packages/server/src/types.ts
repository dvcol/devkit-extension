import type {
  ActionDescriptor,
  CapabilityDescriptor,
  CapabilityResolution,
  ContributionKindDescriptor,
  ContributionKindInstaller,
  DefinitionInstallationApi,
  InstallationResult,
  OperationArguments,
  OperationValue,
  PluginDefinition,
  ProviderDescriptor,
  RuntimeDiagnostic,
  ServiceDeclaration,
} from '@devkit/core';

export interface ServerComposition {
  readonly providerId: string;
  readonly strict?: boolean;
  readonly services?: readonly ServiceDeclaration[];
  readonly plugins?: readonly PluginDefinition[];
  readonly kinds?: readonly ContributionKindInstaller<ContributionKindDescriptor>[];
  /** This local sink may receive native causes; they are not portable diagnostic data. */
  readonly report?: (diagnostic: RuntimeDiagnostic, cause?: unknown) => void;
}

/** Local integration only. This handle does not publish discovery or create a transport. */
export interface ServerProviderHandle {
  readonly provider: ProviderDescriptor;
  readonly services: DefinitionInstallationApi<ServiceDeclaration>;
  readonly plugins: DefinitionInstallationApi<PluginDefinition>;
  readonly startup: {
    readonly services: readonly InstallationResult[];
    readonly plugins: readonly InstallationResult[];
  };
  resolve<Capability extends CapabilityDescriptor>(
    capability: Capability,
  ): Promise<CapabilityResolution<Capability>>;
  invoke<Action extends ActionDescriptor>(
    action: Action,
    ...invocationArguments: OperationArguments<Action['operation']>
  ): Promise<OperationValue<Action['operation']>>;
  /** Dispose adapter-owned contributions. The caller retains ownership of its native host. */
  dispose(): Promise<void>;
}
