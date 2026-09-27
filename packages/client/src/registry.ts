import { defineRealm } from '@devkit/core';
import type { ProviderCatalogSnapshot, ProviderDescriptor } from '@devkit/core';
import { RoutingError } from './errors.js';
import type {
  ClientOptions,
  ConnectionSnapshot,
  ProviderAttachment,
  ProviderConnection,
} from './types.js';

export interface ConnectionEntry {
  readonly provider: ProviderDescriptor;
  readonly connection: ProviderConnection;
  readonly cancellation: AbortController;
  unsubscribe: () => void;
}

function identity(provider: ProviderDescriptor): ProviderDescriptor {
  for (const value of [provider.id, provider.incarnation]) {
    if (typeof value !== 'string' || value.trim().length === 0)
      throw new RoutingError({
        code: 'invalid-connection',
        message: 'Provider ID and incarnation must be non-empty strings',
      });
  }
  return Object.freeze({
    id: provider.id,
    incarnation: provider.incarnation,
    realm: defineRealm(provider.realm),
  });
}

function key(provider: ProviderDescriptor): string {
  return JSON.stringify([provider.realm.id, provider.id]);
}

export function readCatalog(entry: ConnectionEntry): ProviderCatalogSnapshot | undefined {
  const catalog = entry.connection.catalog.snapshot();
  if (catalog === undefined) return undefined;
  if (
    key(catalog.provider) !== key(entry.provider) ||
    catalog.provider.incarnation !== entry.provider.incarnation
  )
    throw new RoutingError({
      code: 'invalid-connection',
      message:
        'A connection catalog changed provider identity; detach it and attach the new incarnation',
    });
  return catalog;
}

export class ConnectionRegistry {
  private readonly cancellation = new AbortController();
  readonly signal = this.cancellation.signal;
  private readonly entries = new Map<string, ConnectionEntry>();
  private readonly listeners = new Set<(snapshot: readonly ConnectionSnapshot[]) => void>();
  private disposed = false;
  constructor(private readonly report: ClientOptions['report']) {}

  attach({ connection }: { readonly connection: ProviderConnection }): ProviderAttachment {
    this.assertOpen();
    const provider = identity(connection.provider);
    if (this.entries.has(key(provider)))
      throw new RoutingError({
        code: 'duplicate-provider',
        message: `Provider ${JSON.stringify([provider.realm.id, provider.id])} is already attached`,
      });
    const entry: ConnectionEntry = {
      provider,
      connection,
      cancellation: new AbortController(),
      unsubscribe() {},
    };
    readCatalog(entry);
    this.entries.set(key(provider), entry);
    try {
      const unsubscribe = connection.catalog.subscribe(() => {
        this.notify();
      });
      entry.unsubscribe = unsubscribe;
      if (this.entries.get(key(provider)) !== entry) unsubscribe();
    } catch (cause) {
      this.detach(entry);
      throw cause;
    }
    this.notify();
    return Object.freeze({
      detach: () => {
        this.detach(entry);
      },
    });
  }

  private detach(entry: ConnectionEntry): void {
    if (this.entries.get(key(entry.provider)) !== entry) return;
    this.entries.delete(key(entry.provider));
    entry.cancellation.abort();
    try {
      entry.unsubscribe();
    } catch (cause) {
      this.observerFailure(cause);
    }
    this.notify();
  }

  private assertOpen(): void {
    if (this.disposed)
      throw new RoutingError({
        code: 'client-disposed',
        message: 'The routing client is disposed',
      });
  }

  list(): readonly ConnectionEntry[] {
    this.assertOpen();
    return [...this.entries.values()];
  }

  assertCurrent(entry: ConnectionEntry): void {
    this.assertOpen();
    if (this.entries.get(key(entry.provider)) !== entry || entry.cancellation.signal.aborted)
      throw new RoutingError({
        code: 'stale-selection',
        message: `Selected provider ${JSON.stringify([entry.provider.realm.id, entry.provider.id, entry.provider.incarnation])} is no longer attached; start a new invocation`,
      });
    readCatalog(entry);
  }

  snapshot(): readonly ConnectionSnapshot[] {
    return Object.freeze(
      [...this.entries.values()].map((entry) =>
        Object.freeze({
          provider: entry.provider,
          status: readCatalog(entry)?.status ?? 'unknown',
        }),
      ),
    );
  }

  subscribe(listener: (snapshot: readonly ConnectionSnapshot[]) => void): () => void {
    this.assertOpen();
    this.listeners.add(listener);
    this.notifyListener(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private observerFailure(cause: unknown): void {
    const error = new RoutingError({
      code: 'listener-failed',
      message: 'A provider connection observer failed',
      cause,
    });
    try {
      if (this.report !== undefined) {
        this.report(error);
        return;
      }
      console.error('[devkit/client]', error);
    } catch {
      /* An observer must not prevent connection cleanup. */
    }
  }

  private notifyListener(listener: (snapshot: readonly ConnectionSnapshot[]) => void): void {
    try {
      listener(this.snapshot());
    } catch (cause) {
      this.observerFailure(cause);
    }
  }

  private notify(): void {
    const listeners = [...this.listeners];
    for (const listener of listeners)
      if (this.listeners.has(listener)) this.notifyListener(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancellation.abort();
    const entries = [...this.entries.values()];
    for (const entry of entries) this.detach(entry);
    this.listeners.clear();
  }
}
