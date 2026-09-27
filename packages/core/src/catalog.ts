import type { AvailabilityReason, ContributionSnapshot } from './runtime-types.js';
import type { ExecutionDescriptor, ProviderDescriptor, Unsubscribe } from './types.js';

/** Portable metadata only; schemas, handlers and native contexts stay with their owner. */
export interface CatalogOperation {
  readonly name: string;
}

export interface CatalogContract {
  readonly id: string;
  readonly version: number;
  readonly contributionId: string;
  readonly execution: ExecutionDescriptor;
  /** Activation state is not proof of authorization or request applicability. */
  readonly status: ContributionSnapshot['status'];
  readonly reason?: AvailabilityReason;
}

export interface CatalogCapability extends CatalogContract {
  readonly operations: readonly CatalogOperation[];
}

export type CatalogAction = CatalogContract;

/** An authoritative local view. Connection adapters separately track remote synchronization. */
export interface ProviderCatalogSnapshot {
  readonly provider: ProviderDescriptor;
  readonly status: 'open' | 'disposing' | 'cleanup-blocked' | 'disposed';
  readonly capabilities: readonly CatalogCapability[];
  readonly actions: readonly CatalogAction[];
}

export interface ProviderCatalog {
  snapshot(): ProviderCatalogSnapshot;
  /** Publishes immediately, then on lifecycle changes. Unsubscribing does not dispose provider work. */
  subscribe(listener: (snapshot: ProviderCatalogSnapshot) => void): Unsubscribe;
}
