import type {
  ActionDeclaration,
  ActionDescriptor,
  ActionInvocationRequest,
  CapabilityDescriptor,
  CapabilityResolution,
  CapabilityResolutionRequest,
  ContributionDeclaration,
  ContributionKindDescriptor,
  ContributionKindInstaller,
  ContributionSnapshot,
  DefinitionInstallationApi,
  ExecutionDescriptor,
  ExtensionDefinition,
  InstallationHandle,
  InstallationResult,
  InstallationSnapshot,
  NativeContextAccess,
  OperationValue,
  PluginDefinition,
  ProviderDescriptor,
  ProviderCatalog,
  RuntimeDiagnostic,
  ServiceDeclaration,
  ScriptDeclaration,
  ViewDeclaration,
} from '@devkit/core';

import type { Activation } from './activation.js';
import type { Reservation, StartupComposition } from './admission.js';

export interface ProviderLifecycleOptions {
  /** The adapter issues an incarnation once per backend lifetime and reuses it across reconnects. */
  readonly provider: ProviderDescriptor;
  readonly execution: ExecutionDescriptor;
  readonly native: NativeContextAccess;
  readonly strict?: boolean;
  readonly kinds?: readonly ContributionKindInstaller<ContributionKindDescriptor>[];
  /** Native causes remain local to this adapter sink and never enter portable diagnostic snapshots. */
  report(diagnostic: RuntimeDiagnostic, cause?: unknown): void;
}

export interface StartupInstallationResult<Strict extends boolean = true> {
  readonly services: readonly InstallationResult<Strict>[];
  readonly plugins: readonly InstallationResult<Strict>[];
}

export interface ProviderLifecycle<Strict extends boolean = true> {
  readonly catalog: ProviderCatalog;
  readonly services: DefinitionInstallationApi<ServiceDeclaration, Strict>;
  readonly plugins: DefinitionInstallationApi<PluginDefinition, Strict>;
  startup(composition: StartupComposition): Promise<StartupInstallationResult<Strict>>;
  resolve<Capability extends CapabilityDescriptor>(
    request: CapabilityResolutionRequest<Capability>,
  ): Promise<CapabilityResolution<Capability>>;
  invoke<Action extends ActionDescriptor>(
    request: ActionInvocationRequest<Action>,
  ): Promise<OperationValue<Action['operation']>>;
  dispose(): Promise<void>;
}

export type ExecutableContribution =
  | ServiceDeclaration
  | ActionDeclaration
  | ViewDeclaration
  | ScriptDeclaration
  | ExtensionDefinition
  | ContributionDeclaration<'transform'>;

export interface OwnedContribution {
  readonly definition: ExecutableContribution;
  readonly installation: OwnedInstallation;
  readonly diagnostics: RuntimeDiagnostic[];
  generation: number;
  status: ContributionSnapshot['status'];
  reason: ContributionSnapshot['reason'] | undefined;
  activation: Activation<unknown> | undefined;
  transition: Promise<void> | undefined;
  failed: boolean;
}

export interface OwnedInstallation {
  readonly reservation: Reservation;
  readonly contributions: OwnedContribution[];
  readonly diagnostics: RuntimeDiagnostic[];
  readonly listeners: Set<(snapshot: InstallationSnapshot) => void>;
  handle: InstallationHandle | undefined;
  enabled: boolean;
  disposing: boolean;
  disposed: boolean;
  disposal: Promise<void> | undefined;
}

export function serviceDeclaration(
  definition: ExecutableContribution,
): ServiceDeclaration | undefined {
  if (definition.kind === 'service') return definition;
  return undefined;
}

export function actionDeclaration(
  definition: ExecutableContribution,
): ActionDeclaration | undefined {
  if (definition.kind === 'action') return definition;
  return undefined;
}

export function extensionDeclaration(
  definition: ExecutableContribution,
): ExtensionDefinition | undefined {
  if (definition.kind === 'extension') return definition;
  return undefined;
}

export function setupDeclaration(
  definition: ExecutableContribution,
): ViewDeclaration | ScriptDeclaration | undefined {
  if (definition.kind === 'view' || definition.kind === 'script') return definition;
  return undefined;
}
