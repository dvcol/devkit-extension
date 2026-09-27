import type {
  ActionClient,
  ActionDescriptor,
  ActionInvocationRequest,
  CapabilityClient,
  CapabilityDescriptor,
  CapabilityResolution,
  CapabilityResolutionRequest,
  InvocationOptions,
  OperationValue,
  ProviderCatalogSnapshot,
  ProviderDescriptor,
  RoutingPolicy,
  TargetReference,
  Unsubscribe,
} from '@devkit/core';
import type { RoutingError } from './errors.js';

/** An adapter-owned, authenticated connection. An undefined catalog means synchronization is incomplete. */
export interface ProviderConnection {
  readonly provider: ProviderDescriptor;
  readonly catalog: {
    snapshot(): ProviderCatalogSnapshot | undefined;
    subscribe(listener: (snapshot: ProviderCatalogSnapshot | undefined) => void): Unsubscribe;
  };
  resolve<Capability extends CapabilityDescriptor>(
    request: CapabilityResolutionRequest<Capability> &
      InvocationOptions & { readonly target?: TargetReference },
  ): Promise<CapabilityResolution<Capability>>;
  invoke<Action extends ActionDescriptor>(
    request: ActionInvocationRequest<Action>,
  ): Promise<OperationValue<Action['operation']>>;
}

export interface ConnectionSnapshot {
  readonly provider: ProviderDescriptor;
  readonly status: ProviderCatalogSnapshot['status'] | 'unknown';
}

export interface ProviderAttachment {
  /** Ends this client's ownership only. Does not close the native host or dispose provider contributions. */
  detach(): void;
}

export interface ClientOptions {
  readonly connections?: readonly ProviderConnection[];
  readonly routing?: RoutingPolicy;
  /** Observer failures are isolated from connection and provider ownership. */
  readonly report?: (error: RoutingError) => void;
}

export interface Client {
  readonly actions: ActionClient;
  readonly capabilities: CapabilityClient;
  readonly providers: {
    attach(request: { readonly connection: ProviderConnection }): ProviderAttachment;
    snapshot(): readonly ConnectionSnapshot[];
    subscribe(listener: (snapshot: readonly ConnectionSnapshot[]) => void): Unsubscribe;
  };
  /** Detaches connections and aborts client-owned work without disposing backend resources. */
  dispose(): void;
}
