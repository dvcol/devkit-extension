import type { InstallationHandle, InstallationSnapshot } from '@devkit/core';

import type { Reservation } from './admission.js';
import { operationError } from './errors.js';
import type { ProviderReconciliation } from './provider-reconciliation.js';
import {
  installationSnapshot,
  notifyInstallation,
  notifyListener,
  providerDiagnostic,
} from './provider-status.js';
import type { ExecutableContribution, OwnedInstallation } from './provider-types.js';

export function createInstallation(reservation: Reservation): OwnedInstallation {
  const installation: OwnedInstallation = {
    reservation,
    contributions: [],
    diagnostics: [...reservation.diagnostics],
    listeners: new Set(),
    handle: undefined,
    enabled: true,
    disposing: false,
    disposed: false,
    disposal: undefined,
  };
  for (const definition of reservation.contributions) {
    /** Admission checked the dedicated list kind and complete built-in declaration shape. */
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The registry validated every contribution against its dedicated declaration kind.
    const validated = definition as ExecutableContribution;
    installation.contributions.push({
      definition: validated,
      installation,
      diagnostics: [],
      generation: 0,
      status: 'waiting',
      reason: undefined,
      activation: undefined,
      transition: undefined,
      failed: false,
    });
  }
  return installation;
}

function assertLive(installation: OwnedInstallation, environment: ProviderReconciliation): void {
  if (installation.disposed || installation.disposing)
    throw operationError(
      providerDiagnostic(
        environment.options,
        'invalid-definition',
        'Installation is disposing or disposed',
        'admission',
        installation,
      ),
    );
}

async function stopInstallation(
  installation: OwnedInstallation,
  environment: ProviderReconciliation,
): Promise<void> {
  const results = await Promise.allSettled(
    installation.contributions.map((contribution) => environment.stop(contribution)),
  );
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason as unknown] : [],
  );
  if (failures.length > 0)
    throw operationError(
      providerDiagnostic(
        environment.options,
        'cleanup-failure',
        'Installation cleanup is blocked',
        'cleanup',
        installation,
      ),
      new AggregateError(failures),
    );
}

export function createInstallationHandle(
  installation: OwnedInstallation,
  environment: ProviderReconciliation,
  released: (installation: OwnedInstallation) => void,
): InstallationHandle {
  return new InstallationController(installation, environment, released);
}

class InstallationController implements InstallationHandle {
  constructor(
    private readonly installation: OwnedInstallation,
    private readonly environment: ProviderReconciliation,
    private readonly released: (installation: OwnedInstallation) => void,
  ) {}
  snapshot(): InstallationSnapshot {
    return installationSnapshot(this.installation);
  }

  subscribe(listener: (value: InstallationSnapshot) => void): () => void {
    if (!this.installation.disposed) this.installation.listeners.add(listener);
    notifyListener(this.installation, listener, this.environment.options);
    return () => {
      this.installation.listeners.delete(listener);
    };
  }

  async enable(): Promise<InstallationSnapshot> {
    assertLive(this.installation, this.environment);
    this.installation.enabled = true;
    for (const contribution of this.installation.contributions) {
      if (contribution.status === 'disabled')
        contribution.status = contribution.failed ? 'failed' : 'waiting';
    }
    this.environment.refresh();
    await this.environment.settle([this.installation]);
    notifyInstallation(this.installation, this.environment.options);
    return this.snapshot();
  }

  async disable(): Promise<InstallationSnapshot> {
    assertLive(this.installation, this.environment);
    this.installation.enabled = false;
    const stopping = stopInstallation(this.installation, this.environment);
    notifyInstallation(this.installation, this.environment.options);
    await stopping;
    return this.snapshot();
  }

  async retry(contributionId: string): Promise<InstallationSnapshot> {
    assertLive(this.installation, this.environment);
    const contribution = this.installation.contributions.find(
      (candidate) => candidate.definition.id === contributionId,
    );
    if (contribution === undefined)
      throw operationError(
        providerDiagnostic(
          this.environment.options,
          'invalid-definition',
          `Unknown contribution ${contributionId}`,
          'admission',
          this.installation,
        ),
      );
    if (contribution.status === 'cleanup-blocked')
      throw operationError(
        providerDiagnostic(
          this.environment.options,
          'cleanup-failure',
          'Retry cannot bypass blocked cleanup',
          'cleanup',
          this.installation,
          contribution,
        ),
      );
    if (contribution.failed) {
      contribution.failed = false;
      contribution.diagnostics.splice(0);
      contribution.status = this.installation.enabled ? 'waiting' : 'disabled';
      contribution.activation = undefined;
    }
    await this.environment.settle([this.installation]);
    notifyInstallation(this.installation, this.environment.options);
    return this.snapshot();
  }

  dispose(): Promise<void> {
    if (this.installation.disposal !== undefined) return this.installation.disposal;
    this.installation.disposing = true;
    this.installation.enabled = false;
    this.installation.disposal = Promise.resolve().then(() => this.completeDisposal());
    /** Mark all children before yielding so no client can dispatch another operation. */
    for (const contribution of this.installation.contributions)
      void this.environment.stop(contribution).catch(() => {});
    notifyInstallation(this.installation, this.environment.options);
    return this.installation.disposal;
  }

  private async completeDisposal(): Promise<void> {
    await stopInstallation(this.installation, this.environment);
    this.installation.disposed = true;
    this.installation.disposing = false;
    this.released(this.installation);
    notifyInstallation(this.installation, this.environment.options);
    this.installation.listeners.clear();
    this.environment.refresh();
  }
}
