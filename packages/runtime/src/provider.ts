import { defineExecution, isOperationError } from '@devkit/core';
import type {
  ActionDescriptor,
  ActionInvocationRequest,
  CapabilityDescriptor,
  CapabilityResolutionRequest,
  InstallationHandle,
  InstallationResult,
  PluginDefinition,
  ServiceDeclaration,
} from '@devkit/core';

import { createAdmissionRegistry } from './admission.js';
import type { Admission, StartupComposition } from './admission.js';
import { operationError } from './errors.js';
import { invokeAction, resolveLocal } from './provider-bindings.js';
import { snapshotProvider } from './provider-identity.js';
import { createInstallation, createInstallationHandle } from './provider-installations.js';
import { singleComposition, snapshotComposition, validatePayloads } from './provider-preflight.js';
import { createReconciliation } from './provider-reconciliation.js';
import { providerDiagnostic, reportDiagnostic } from './provider-status.js';
import type {
  OwnedInstallation,
  ProviderLifecycle,
  ProviderLifecycleOptions,
  StartupInstallationResult,
} from './provider-types.js';

export type {
  ProviderLifecycle,
  ProviderLifecycleOptions,
  StartupInstallationResult,
} from './provider-types.js';

/**
 * Adapter-owned activation and local calls; communication and state stay with the native host.
 * Replacements serialize with each other while disjoint ordinary admission remains available.
 */
export function createProviderLifecycle(input: ProviderLifecycleOptions): ProviderLifecycle {
  return new ProviderController(input);
}

class ProviderController implements ProviderLifecycle {
  private readonly options: ProviderLifecycleOptions;
  private readonly installations = new Set<OwnedInstallation>();
  private readonly handles = new WeakMap<InstallationHandle, OwnedInstallation>();
  private readonly registry: ReturnType<typeof createAdmissionRegistry>;
  private readonly environment: ReturnType<typeof createReconciliation>;
  private mutation: Promise<unknown> = Promise.resolve();
  private replacements: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private disposal: Promise<void> | undefined;
  readonly services = {
    install: (definition: ServiceDeclaration) => this.install('service', definition),
    replace: (handle: InstallationHandle, definition: ServiceDeclaration) =>
      this.replace('service', handle, definition),
  };
  readonly plugins = {
    install: (definition: PluginDefinition) => this.install('plugin', definition),
    replace: (handle: InstallationHandle, definition: PluginDefinition) =>
      this.replace('plugin', handle, definition),
  };
  constructor(input: ProviderLifecycleOptions) {
    this.options = {
      ...input,
      provider: snapshotProvider(input.provider),
      execution: defineExecution(input.execution),
    };
    this.registry = createAdmissionRegistry({
      providerId: this.options.provider.id,
      ...(this.options.strict === undefined ? {} : { strict: this.options.strict }),
      ...(this.options.kinds === undefined ? {} : { kinds: this.options.kinds }),
    });
    this.environment = createReconciliation(this.options, this.installations);
  }
  resolve<Capability extends CapabilityDescriptor>(
    request: CapabilityResolutionRequest<Capability>,
  ) {
    return Promise.resolve(resolveLocal(this.environment, request.capability));
  }
  invoke<Action extends ActionDescriptor>(request: ActionInvocationRequest<Action>) {
    return invokeAction(this.environment, request);
  }
  private assertOpen(): void {
    if (this.disposed)
      throw operationError(
        providerDiagnostic(
          this.options,
          'unavailable-capability',
          'Provider is disposed',
          'admission',
        ),
      );
  }

  /** Serialize preflight and reservation without holding the turn through replacement cleanup. */
  private mutate<Value>(work: () => Promise<Value>): Promise<Value> {
    const result = this.mutation.then(work);
    this.mutation = result.catch(() => {});
    return result;
  }

  private release(installation: OwnedInstallation): void {
    this.registry.release(installation.reservation);
    this.installations.delete(installation);
    if (installation.handle !== undefined) this.handles.delete(installation.handle);
  }

  private publish(admissions: readonly Admission[]): {
    results: InstallationResult[];
    owned: OwnedInstallation[];
  } {
    const results: InstallationResult[] = [];
    const owned: OwnedInstallation[] = [];
    for (const admission of admissions) {
      if (admission.status === 'skipped') {
        reportDiagnostic(this.options, admission.diagnostic);
        results.push({ status: 'skipped', diagnostic: admission.diagnostic });
        continue;
      }
      const installation = createInstallation(admission.reservation);
      const handle = createInstallationHandle(
        installation,
        this.environment,
        (ownedInstallation) => {
          this.release(ownedInstallation);
        },
      );
      installation.handle = handle;
      this.installations.add(installation);
      this.handles.set(handle, installation);
      owned.push(installation);
      results.push({ status: 'admitted', handle });
      for (const diagnostic of installation.diagnostics)
        reportDiagnostic(this.options, diagnostic, installation);
    }
    return { results, owned };
  }

  private async checked<Value>(work: () => Promise<Value>): Promise<Value> {
    try {
      return await work();
    } catch (cause) {
      const error = isOperationError(cause)
        ? cause
        : operationError(
            providerDiagnostic(
              this.options,
              'invalid-definition',
              'Provider admission failed',
              'admission',
            ),
            cause,
          );
      reportDiagnostic(this.options, error.diagnostic, undefined, error.cause);
      throw error;
    }
  }

  startup(composition: StartupComposition): Promise<StartupInstallationResult> {
    return this.checked(async () => {
      this.assertOpen();
      const snapshot = snapshotComposition(composition);
      const published = await this.mutate(async () => {
        this.assertOpen();
        this.registry.preflight(snapshot);
        await validatePayloads(snapshot, this.environment);
        this.assertOpen();
        return this.publish(this.registry.reserve(snapshot));
      });
      await this.environment.settle(published.owned);
      const serviceCount = snapshot.services?.length ?? 0;
      return {
        services: published.results.slice(0, serviceCount),
        plugins: published.results.slice(serviceCount),
      };
    });
  }

  private async install(
    kind: 'service' | 'plugin',
    definition: ServiceDeclaration | PluginDefinition,
  ): Promise<InstallationResult> {
    const result = await this.startup(singleComposition(kind, definition));
    const installation = kind === 'service' ? result.services[0] : result.plugins[0];
    if (installation === undefined) throw new Error('Missing installation result');
    return installation;
  }

  private replace(
    kind: 'service' | 'plugin',
    handle: InstallationHandle,
    definition: ServiceDeclaration | PluginDefinition,
  ): Promise<InstallationResult> {
    return this.checked(() => {
      this.assertOpen();
      const snapshot = snapshotComposition(singleComposition(kind, definition));
      const result = this.replacements.then(() => this.performReplacement(kind, handle, snapshot));
      this.replacements = result.catch(() => {});
      return result;
    });
  }

  private replacementOwner(
    kind: 'service' | 'plugin',
    handle: InstallationHandle,
  ): OwnedInstallation {
    const current = this.handles.get(handle);
    if (
      current === undefined ||
      current.reservation.kind !== kind ||
      current.disposed ||
      current.disposing
    )
      throw operationError(
        providerDiagnostic(
          this.options,
          'invalid-definition',
          'Replacement requires a live matching installation handle',
          'admission',
        ),
      );
    return current;
  }

  private async performReplacement(
    kind: 'service' | 'plugin',
    handle: InstallationHandle,
    snapshot: StartupComposition,
  ): Promise<InstallationResult> {
    this.assertOpen();
    const current = this.replacementOwner(kind, handle);
    const transaction = await this.mutate(async () => {
      this.assertOpen();
      this.registry.preflight(snapshot, current.reservation);
      await validatePayloads(snapshot, this.environment);
      this.assertOpen();
      this.replacementOwner(kind, handle);
      return this.registry.beginReplacement(snapshot, current.reservation);
    });
    const firstAdmission = transaction.admissions[0];
    if (kind === 'service' && firstAdmission?.status === 'skipped') {
      transaction.abort();
      reportDiagnostic(this.options, firstAdmission.diagnostic);
      return { status: 'skipped', diagnostic: firstAdmission.diagnostic };
    }
    let admissions: readonly Admission[];
    try {
      await handle.dispose();
      this.assertOpen();
      admissions = transaction.commit();
    } catch (error) {
      transaction.abort();
      throw error;
    }
    const published = this.publish(admissions);
    await this.environment.settle(published.owned);
    const result = published.results[0];
    if (result === undefined) throw new Error('Missing replacement result');
    return result;
  }

  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal;
    this.disposed = true;
    const pending: Promise<void>[] = [];
    this.disposal = Promise.resolve().then(() => this.completeDisposal(pending));
    for (const installation of this.installations) {
      if (installation.handle !== undefined) pending.push(installation.handle.dispose());
    }
    return this.disposal;
  }

  private async completeDisposal(pending: readonly Promise<void>[]): Promise<void> {
    const results = await Promise.allSettled(pending);
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason as unknown] : [],
    );
    if (failures.length > 0)
      throw operationError(
        providerDiagnostic(
          this.options,
          'cleanup-failure',
          'Provider cleanup is blocked',
          'cleanup',
        ),
        new AggregateError(failures),
      );
  }
}
