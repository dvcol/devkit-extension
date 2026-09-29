import type { RpcFunctionsHost, DevframeRpcServerFunctions } from 'devframe/types';
import type { RpcFunctionsCollectorBase } from 'devframe/rpc';

import type {
  ActionDescriptor,
  ExecutionDescriptor,
  NativeContextAccess,
  RealmDescriptor,
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

export interface RpcProviderComposition<Strict extends boolean = true> {
  readonly providerId: string;
  readonly strict?: Strict;
  /** Explicit host-owned native RPC contracts; omitted contracts stay local. */
  readonly expose?: RpcProviderExposure;
  readonly services?: readonly ServiceDeclaration[];
  readonly plugins?: readonly PluginDefinition[];
  readonly kinds?: readonly ContributionKindInstaller<ContributionKindDescriptor>[];
  /** This local sink may receive native causes; they are not portable diagnostic data. */
  readonly report?: (diagnostic: RuntimeDiagnostic, cause?: unknown) => void;
}

/** The native host owns these named methods independently of implementation availability. */
export interface RpcProviderExposure {
  readonly actions?: readonly ActionDescriptor[];
  readonly capabilities?: readonly CapabilityDescriptor[];
}

/** Native registration and broadcast members used by portable exposure. */
export type ProviderRpc<Context = never> = Pick<
  RpcFunctionsCollectorBase<DevframeRpcServerFunctions, Context>,
  'register' | 'has'
> &
  Pick<RpcFunctionsHost, 'broadcast'>;

export interface RpcProviderOptions<
  Strict extends boolean = true,
  Context = never,
> extends RpcProviderComposition<Strict> {
  readonly context: {
    readonly rpc: ProviderRpc<Context>;
    readonly realm: RealmDescriptor;
    readonly execution: ExecutionDescriptor;
    readonly native: NativeContextAccess;
  };
}

/** Installs into the supplied native host; discovery and transport remain host-owned. */
export interface RpcProviderHandle<Strict extends boolean = true> {
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
