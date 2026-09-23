import type {
  ActionDeclaration,
  ActionDescriptor,
  CapabilityDescriptor,
  CapabilityResolution,
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
  OperationArguments,
  OperationValue,
  PluginDefinition,
  ProviderDescriptor,
  RuntimeDiagnostic,
  ServiceDeclaration,
} from '@devkit/core';

import type { Activation } from './activation.js';
import type { Reservation, StartupComposition } from './admission.js';

export interface ProviderLifecycleOptions {
  readonly provider: ProviderDescriptor;
  readonly execution: ExecutionDescriptor;
  readonly native: NativeContextAccess;
  readonly strict?: boolean;
  readonly kinds?: readonly ContributionKindInstaller<ContributionKindDescriptor>[];
  /** Native causes remain local to this adapter sink and never enter portable diagnostic snapshots. */
  report(diagnostic: RuntimeDiagnostic, cause?: unknown): void;
}

export interface StartupInstallationResult {
  readonly services: readonly InstallationResult[];
  readonly plugins: readonly InstallationResult[];
}

export interface ProviderLifecycle {
  readonly services: DefinitionInstallationApi<ServiceDeclaration>;
  readonly plugins: DefinitionInstallationApi<PluginDefinition>;
  startup(composition: StartupComposition): Promise<StartupInstallationResult>;
  resolve<Capability extends CapabilityDescriptor>(
    capability: Capability,
  ): Promise<CapabilityResolution<Capability>>;
  invoke<Action extends ActionDescriptor>(
    action: Action,
    ...invocationArguments: OperationArguments<Action['operation']>
  ): Promise<OperationValue<Action['operation']>>;
  dispose(): Promise<void>;
}

export type ExecutableContribution =
  | ServiceDeclaration
  | ActionDeclaration
  | ExtensionDefinition
  | ContributionDeclaration<'view' | 'transform' | 'script'>;

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
