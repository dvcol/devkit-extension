import type {
  AvailabilityReason,
  ContributionKindDescriptor,
  ContributionKindInstaller,
} from '@devkit/core';

import { operationError } from './errors.js';
import { requirementsOf, startContribution } from './provider-activation.js';
import type { ActivationEnvironment } from './provider-activation.js';
import { allContributions, findService, unavailableReason } from './provider-bindings.js';
import {
  contributionDiagnostic,
  notifyInstallation,
  providerDiagnostic,
} from './provider-status.js';
import { extensionDeclaration, serviceDeclaration } from './provider-types.js';
import type {
  OwnedContribution,
  OwnedInstallation,
  ProviderLifecycleOptions,
} from './provider-types.js';

export interface ProviderReconciliation extends ActivationEnvironment {
  stop(contribution: OwnedContribution): Promise<void>;
  settle(installations: readonly OwnedInstallation[]): Promise<void>;
}

export function createReconciliation(
  options: ProviderLifecycleOptions,
  installations: ReadonlySet<OwnedInstallation>,
): ProviderReconciliation {
  return new ReconciliationController(options, installations);
}

class ReconciliationController implements ProviderReconciliation {
  readonly kinds: ReadonlyMap<string, ContributionKindInstaller<ContributionKindDescriptor>>;
  private refreshing = false;
  private refreshAgain = false;
  constructor(
    readonly options: ProviderLifecycleOptions,
    readonly installations: ReadonlySet<OwnedInstallation>,
  ) {
    this.kinds = new Map(options.kinds?.map((installer) => [installer.descriptor.id, installer]));
  }
  refresh(): void {
    if (this.refreshing) {
      this.refreshAgain = true;
      return;
    }
    this.refreshing = true;
    do {
      this.refreshAgain = false;
      for (const contribution of allContributions(this)) reconcileContribution(this, contribution);
    } while (this.refreshAgain);
    this.refreshing = false;
  }

  stop(contribution: OwnedContribution): Promise<void> {
    if (contribution.status === 'stopping' || contribution.status === 'cleanup-blocked')
      return blockedStop(this, contribution);
    if (
      contribution.activation === undefined ||
      contribution.status === 'waiting' ||
      contribution.status === 'disabled' ||
      contribution.status === 'failed' ||
      contribution.status === 'disposed'
    ) {
      settleStoppedStatus(contribution);
      notifyInstallation(contribution.installation, this.options);
      return Promise.resolve();
    }
    contribution.status = 'stopping';
    const transition = Promise.resolve().then(() =>
      completeStop(
        this,
        contribution,
        dependentContributions(this, contribution).map((dependent) => this.stop(dependent)),
      ),
    );
    contribution.transition = transition;
    contribution.activation.cancel();
    void transition.then(
      () => {
        if (contribution.transition === transition) contribution.transition = undefined;
        this.refresh();
        return true;
      },
      () => {
        this.refresh();
        return false;
      },
    );
    notifyInstallation(contribution.installation, this.options);
    return transition;
  }

  async settle(seeds: readonly OwnedInstallation[]): Promise<void> {
    const relevant = new Set(seeds.flatMap((installation) => installation.contributions));
    let pending: Promise<void>[];
    do {
      this.refresh();
      for (const contribution of relevant)
        for (const dependent of dependentContributions(this, contribution)) relevant.add(dependent);
      pending = [...relevant].flatMap((contribution) =>
        contribution.transition === undefined || contribution.status === 'cleanup-blocked'
          ? []
          : [contribution.transition],
      );
      await Promise.allSettled(pending);
    } while (pending.length > 0);
  }
}

function blockedStop(
  environment: ProviderReconciliation,
  contribution: OwnedContribution,
): Promise<void> {
  return (
    contribution.transition ??
    Promise.reject(
      operationError(
        providerDiagnostic(
          environment.options,
          'cleanup-failure',
          'Contribution cleanup is blocked',
          'cleanup',
          contribution.installation,
          contribution,
        ),
      ),
    )
  );
}

function dependentContributions(
  environment: ActivationEnvironment,
  provider: OwnedContribution,
): OwnedContribution[] {
  const service = serviceDeclaration(provider.definition);
  if (service === undefined) return [];
  return allContributions(environment).filter(
    (contribution) =>
      contribution !== provider &&
      !contribution.installation.disposed &&
      Object.values(requirementsOf(contribution)).some(
        (requirement) =>
          requirement.id === service.capability.id &&
          requirement.version === service.capability.version,
      ),
  );
}

function eligibility(
  environment: ActivationEnvironment,
  contribution: OwnedContribution,
): AvailabilityReason | undefined {
  if (contribution.definition.execution.id !== environment.options.execution.id)
    return 'wrong-execution';
  const extension = extensionDeclaration(contribution.definition);
  if (extension !== undefined && !environment.kinds.has(extension.descriptor.id))
    return 'unsupported';
  if (['view', 'transform', 'script'].includes(contribution.definition.kind)) return 'unsupported';
  for (const requirement of Object.values(requirementsOf(contribution))) {
    if (findService(environment, requirement)?.status !== 'active') {
      const reason = unavailableReason(environment, requirement);
      return reason === 'incompatible-contract' ? reason : 'dependency-unavailable';
    }
  }
  return undefined;
}

function reconcileContribution(
  environment: ProviderReconciliation,
  contribution: OwnedContribution,
): void {
  const installation = contribution.installation;
  if (installation.disposing || installation.disposed || !installation.enabled) return;
  if (
    contribution.status === 'cleanup-blocked' ||
    contribution.status === 'stopping' ||
    contribution.failed
  )
    return;
  const reason = eligibility(environment, contribution);
  if (reason !== undefined) {
    if (contribution.status === 'active' || contribution.status === 'starting') {
      void environment.stop(contribution).catch(() => {});
      return;
    }
    updateWaitingReason(environment, contribution, reason);
    return;
  }
  if (contribution.status !== 'waiting') return;
  contribution.diagnostics.splice(0);
  startContribution(environment, contribution);
}

function updateWaitingReason(
  environment: ActivationEnvironment,
  contribution: OwnedContribution,
  reason: AvailabilityReason,
): void {
  if (contribution.reason === reason) return;
  contribution.reason = reason;
  contribution.status = 'waiting';
  if (reason === 'incompatible-contract') {
    const diagnostic = providerDiagnostic(
      environment.options,
      reason,
      'An exact required contract version is unavailable',
      'setup',
      contribution.installation,
      contribution,
    );
    const reported =
      environment.options.strict === false
        ? { ...diagnostic, severity: 'warning' as const }
        : diagnostic;
    contribution.diagnostics.push(reported);
    try {
      environment.options.report(reported);
    } catch {
      /* Status remains observable if the host sink fails. */
    }
  }
  notifyInstallation(contribution.installation, environment.options);
}

function settleStoppedStatus(contribution: OwnedContribution): void {
  if (contribution.installation.disposing || contribution.installation.disposed)
    contribution.status = 'disposed';
  else if (!contribution.installation.enabled) contribution.status = 'disabled';
  else if (contribution.failed) contribution.status = 'failed';
  else contribution.status = 'waiting';
}

async function completeStop(
  environment: ProviderReconciliation,
  contribution: OwnedContribution,
  dependents: readonly Promise<void>[],
): Promise<void> {
  try {
    const outcomes = await Promise.allSettled(dependents);
    const failures = outcomes.flatMap((outcome) =>
      outcome.status === 'rejected' ? [outcome.reason as unknown] : [],
    );
    if (failures.length > 0) throw new AggregateError(failures, 'Dependent cleanup is blocked');
    await contribution.activation?.stop();
    contribution.activation = undefined;
    settleStoppedStatus(contribution);
  } catch (cause) {
    contribution.status = 'cleanup-blocked';
    const diagnostic = contributionDiagnostic(
      contribution,
      environment.options,
      'cleanup-failure',
      'Contribution cleanup is blocked',
      'cleanup',
      cause,
    );
    throw operationError(diagnostic, cause);
  }
  notifyInstallation(contribution.installation, environment.options);
}
