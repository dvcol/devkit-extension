import type { DevframeHubContext } from '@devframes/hub/node';
import type { KitNodeContext } from '@vitejs/devtools-kit/node';

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
  /** Explicit host-owned native RPC contracts; omitted contracts stay local. */
  readonly expose?: ServerExposure;
  readonly services?: readonly ServiceDeclaration[];
  readonly plugins?: readonly PluginDefinition[];
  readonly kinds?: readonly ContributionKindInstaller<ContributionKindDescriptor>[];
  /** This local sink may receive native causes; they are not portable diagnostic data. */
  readonly report?: (diagnostic: RuntimeDiagnostic, cause?: unknown) => void;
}

/** The native host owns these named methods independently of implementation availability. */
export interface ServerExposure {
  readonly actions?: readonly ActionDescriptor[];
  readonly capabilities?: readonly CapabilityDescriptor[];
}

export interface DevframeProviderOptions<
  Strict extends boolean = true,
> extends ServerComposition<Strict> {
  readonly context: DevframeHubContext;
}

export interface DevToolsProviderOptions<
  Strict extends boolean = true,
> extends ServerComposition<Strict> {
  readonly context: KitNodeContext;
}

/** Installs into the supplied native host; discovery and transport remain host-owned. */
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
