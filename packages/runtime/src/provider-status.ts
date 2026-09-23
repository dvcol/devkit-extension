import type { ContributionSnapshot, InstallationSnapshot, RuntimeDiagnostic } from '@devkit/core';

import type {
  OwnedContribution,
  OwnedInstallation,
  ProviderLifecycleOptions,
} from './provider-types.js';

export function providerDiagnostic(
  options: ProviderLifecycleOptions,
  code: string,
  message: string,
  phase: RuntimeDiagnostic['phase'],
  installation?: OwnedInstallation,
  contribution?: OwnedContribution,
): RuntimeDiagnostic {
  return Object.freeze({
    code,
    message,
    phase,
    severity: 'error',
    providerId: options.provider.id,
    ...(installation?.reservation.kind === 'plugin'
      ? { pluginId: installation.reservation.id }
      : {}),
    ...(contribution === undefined ? {} : { contributionId: contribution.definition.id }),
  });
}

/** Reporting failures must not corrupt resource ownership or recursively call the broken sink. */
export function reportDiagnostic(
  options: ProviderLifecycleOptions,
  diagnostic: RuntimeDiagnostic,
  installation?: OwnedInstallation,
  cause?: unknown,
): void {
  try {
    options.report(diagnostic, cause);
  } catch {
    if (installation !== undefined) {
      installation.diagnostics.push(
        providerDiagnostic(
          options,
          'diagnostic-sink-failed',
          'The diagnostic sink threw while reporting a failure',
          diagnostic.phase,
          installation,
        ),
      );
    }
  }
}

export function contributionSnapshot(contribution: OwnedContribution): ContributionSnapshot {
  return Object.freeze({
    id: contribution.definition.id,
    kind: contribution.definition.kind,
    generation: contribution.generation,
    enabled: contribution.installation.enabled,
    status: contribution.status,
    ...(contribution.reason === undefined ? {} : { reason: contribution.reason }),
    diagnostics: Object.freeze([...contribution.diagnostics]),
  });
}

function installationStatus(installation: OwnedInstallation): InstallationSnapshot['status'] {
  const contributions = installation.contributions;
  if (contributions.some((contribution) => contribution.status === 'cleanup-blocked'))
    return 'cleanup-blocked';
  if (installation.disposed) return 'disposed';
  if (installation.disposing) return 'disposing';
  const activeCount = contributions.filter(
    (contribution) => contribution.status === 'active',
  ).length;
  const diagnostics =
    installation.diagnostics.length > 0 ||
    contributions.some((contribution) => contribution.diagnostics.length > 0);
  if (activeCount > 0 && activeCount === contributions.length && !diagnostics) return 'ready';
  if (
    activeCount > 0 ||
    diagnostics ||
    contributions.some((contribution) => contribution.status === 'failed')
  )
    return 'partial';
  return 'inactive';
}

export function installationSnapshot(installation: OwnedInstallation): InstallationSnapshot {
  return Object.freeze({
    id: installation.reservation.id,
    status: installationStatus(installation),
    contributions: Object.freeze(installation.contributions.map(contributionSnapshot)),
    diagnostics: Object.freeze([
      ...installation.diagnostics,
      ...installation.contributions.flatMap((contribution) => contribution.diagnostics),
    ]),
  });
}

export function notifyListener(
  installation: OwnedInstallation,
  listener: (snapshot: InstallationSnapshot) => void,
  options: ProviderLifecycleOptions,
): void {
  try {
    listener(installationSnapshot(installation));
  } catch (cause) {
    const diagnostic = providerDiagnostic(
      options,
      'listener-failed',
      'An installation status listener threw',
      'call',
      installation,
    );
    installation.diagnostics.push(diagnostic);
    reportDiagnostic(options, diagnostic, installation, cause);
  }
}

export function notifyInstallation(
  installation: OwnedInstallation,
  options: ProviderLifecycleOptions,
): void {
  const listeners = [...installation.listeners];
  for (const listener of listeners) {
    if (installation.listeners.has(listener)) notifyListener(installation, listener, options);
  }
}

export function contributionDiagnostic(
  contribution: OwnedContribution,
  options: ProviderLifecycleOptions,
  code: string,
  message: string,
  phase: RuntimeDiagnostic['phase'],
  cause?: unknown,
): RuntimeDiagnostic {
  const diagnostic = providerDiagnostic(
    options,
    code,
    message,
    phase,
    contribution.installation,
    contribution,
  );
  contribution.diagnostics.push(diagnostic);
  reportDiagnostic(options, diagnostic, contribution.installation, cause);
  notifyInstallation(contribution.installation, options);
  return diagnostic;
}
