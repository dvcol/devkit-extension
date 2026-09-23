import { admitDefinition, pluginInput } from './provider-admission-validation.js';
import { createDiagnostic } from './provider-admission-diagnostic.js';
import { assertAcyclic } from './provider-admission-graph.js';
import { definePlugin, isOperationError } from '@devkit/core';
import type {
  ActionDeclaration,
  ContributionDeclaration,
  ContributionKindDescriptor,
  ContributionKindInstaller,
  PluginDefinition,
  RuntimeDiagnostic,
  ServiceDeclaration,
} from '@devkit/core';

import { operationError } from './errors.js';

export interface StartupComposition {
  readonly services?: readonly ServiceDeclaration[];
  readonly plugins?: readonly PluginDefinition[];
}

export interface Reservation {
  readonly id: string;
  readonly kind: 'plugin' | 'service';
  readonly services: readonly ServiceDeclaration[];
  readonly actions: readonly ActionDeclaration[];
  readonly contributions: readonly ContributionDeclaration[];
  readonly diagnostics: readonly RuntimeDiagnostic[];
}

export type Admission =
  | { readonly status: 'reserved'; readonly reservation: Reservation }
  | { readonly status: 'skipped'; readonly diagnostic: RuntimeDiagnostic };

export interface RegistryOptions {
  readonly providerId: string;
  readonly strict?: boolean;
  readonly kinds?: readonly ContributionKindInstaller<ContributionKindDescriptor>[];
}

interface PendingReplacement {
  readonly current: Reservation;
  readonly incoming: readonly Admission[];
  readonly successors: ReadonlyMap<string, Reservation>;
  readonly lockedKeys: ReadonlySet<string>;
}

const replacementLock: Reservation = Object.freeze({
  id: 'pending-replacement',
  kind: 'plugin',
  services: [],
  actions: [],
  contributions: [],
  diagnostics: [],
});

/** Synchronous admission reserves the entire batch before any asynchronous setup runs. */
export function createAdmissionRegistry(options: RegistryOptions) {
  return new AdmissionRegistry(options);
}

class AdmissionRegistry {
  private readonly owners = new Map<string, Reservation>();
  private readonly customKinds: ReadonlySet<string>;
  private replacement: PendingReplacement | undefined;
  constructor(private readonly options: RegistryOptions) {
    this.customKinds = new Set(options.kinds?.map((installer) => installer.descriptor.id));
    if (this.customKinds.size !== (options.kinds?.length ?? 0))
      throw operationError(
        createDiagnostic(options, 'duplicate-registration', 'Duplicate custom kind installer'),
      );
  }
  reserve(composition: StartupComposition): readonly Admission[] {
    try {
      return this.reserveBatch(composition);
    } catch (cause) {
      if (isOperationError(cause)) throw cause;
      throw operationError(
        createDiagnostic(
          this.options,
          'invalid-definition',
          'Admission contains an invalid definition',
        ),
        cause,
      );
    }
  }

  prepareBatch(composition: StartupComposition, replacing?: Reservation) {
    const pending = new Map(this.owners);
    if (this.replacement !== undefined) {
      for (const key of this.replacement.lockedKeys)
        if (!pending.has(key)) pending.set(key, replacementLock);
    }
    if (replacing !== undefined) {
      for (const [key, owner] of pending) if (owner === replacing) pending.delete(key);
    }
    const incoming: Admission[] = [];
    for (const service of composition.services ?? []) {
      const definition = { id: service.id, services: [service] };
      incoming.push(
        admitDefinition(
          definePlugin(definition),
          'service',
          pending,
          this.options,
          this.customKinds,
        ),
      );
    }
    for (const plugin of composition.plugins ?? []) {
      incoming.push(
        admitDefinition(
          definePlugin(pluginInput(plugin)),
          'plugin',
          pending,
          this.options,
          this.customKinds,
        ),
      );
    }
    this.checkCycles(pending);
    this.checkFutureCycles(pending);
    return { pending, incoming };
  }

  private checkFutureCycles(pending: ReadonlyMap<string, Reservation>): void {
    if (this.replacement !== undefined) {
      const future = new Map(pending);
      for (const [key, owner] of future)
        if (owner === this.replacement.current || owner === replacementLock) future.delete(key);
      for (const [key, owner] of this.replacement.successors) future.set(key, owner);
      this.checkCycles(future);
    }
  }

  private checkCycles(owners: ReadonlyMap<string, Reservation>): void {
    assertAcyclic(owners, (key) => {
      throw operationError(
        createDiagnostic(
          this.options,
          'dependency-cycle',
          `Capability dependency cycle includes ${key}`,
        ),
      );
    });
  }

  reserveBatch(composition: StartupComposition): readonly Admission[] {
    const { pending, incoming } = this.prepareBatch(composition);
    for (const [key, owner] of pending) {
      if (owner !== replacementLock) this.owners.set(key, owner);
    }
    return incoming;
  }

  /** Preview is inert; replacement transactions separately reserve their successor identities. */
  preflight(composition: StartupComposition, replacing?: Reservation): void {
    try {
      this.prepareBatch(composition, replacing);
    } catch (cause) {
      if (isOperationError(cause)) throw cause;
      throw operationError(
        createDiagnostic(
          this.options,
          'invalid-definition',
          'Replacement contains an invalid definition',
        ),
        cause,
      );
    }
  }

  release(reservation: Reservation): void {
    for (const [key, owner] of this.owners) {
      if (owner === reservation) this.owners.delete(key);
    }
  }

  /** One replacement at a time permits exact current/future cycle checks without blocking disjoint admission. */
  beginReplacement(composition: StartupComposition, current: Reservation) {
    if (this.replacement !== undefined)
      throw new Error('A replacement transaction is already pending');
    const { pending, incoming } = this.prepareBatch(composition, current);
    const reservations = new Set(
      incoming.flatMap((admission) =>
        admission.status === 'reserved' ? [admission.reservation] : [],
      ),
    );
    const successors = new Map([...pending].filter(([, owner]) => reservations.has(owner)));
    const lockedKeys = new Set(successors.keys());
    for (const [key, owner] of this.owners) if (owner === current) lockedKeys.add(key);
    const replacement: PendingReplacement = { current, incoming, successors, lockedKeys };
    this.replacement = replacement;
    return {
      admissions: Object.freeze([...incoming]),
      commit: (): readonly Admission[] => {
        if (this.replacement !== replacement)
          throw new Error('Replacement transaction is no longer active');
        this.release(current);
        for (const [key, owner] of successors) this.owners.set(key, owner);
        this.replacement = undefined;
        return incoming;
      },
      abort: (): void => {
        if (this.replacement === replacement) this.replacement = undefined;
      },
    };
  }
}
