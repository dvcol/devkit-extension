import type { ProviderCatalogSnapshot, ProviderDescriptor } from '@devkit/core';
import type { ProviderRpcClient } from './types.js';
import { captureCatalog } from '../catalog-schema.js';
import { catalogMethod } from '../rpc-contract.js';
import { onCatalogChanged } from './catalog-events.js';
import { nativeCall, waitForNative } from './native-call.js';

export interface RemoteCatalogOptions<Context = never> {
  readonly rpc: ProviderRpcClient<Context>;
  readonly providerId: string;
  readonly realm: { readonly id: string };
  readonly report?: (error: Error) => void;
}

/** Owns only metadata synchronization and local waits, never the supplied native connection. */
export class RemoteCatalog<Context> {
  private readonly cancellation = new AbortController();
  readonly signal = this.cancellation.signal;
  private readonly listeners = new Set<(snapshot: ProviderCatalogSnapshot | undefined) => void>();
  private readonly cleanup: (() => void)[] = [];
  private current: ProviderCatalogSnapshot | undefined;
  private identity: ProviderDescriptor | undefined;
  private revision = 0;
  private pending: Promise<void> | undefined;

  constructor(readonly options: RemoteCatalogOptions<Context>) {}

  get provider(): ProviderDescriptor {
    if (this.identity === undefined) throw new Error('Provider catalog has not synchronized');
    return this.identity;
  }

  async start(): Promise<void> {
    const { rpc, providerId } = this.options;
    if (providerId.trim().length === 0) throw new TypeError('Provider ID must not be empty');
    this.cleanup[0] = onCatalogChanged(rpc, () => {
      this.invalidate();
    });
    this.cleanup.push(
      rpc.events.on('connection:status', (status) => {
        if (status === 'connecting' || status === 'connected') return;
        this.dispose(rpc.connectionError ?? new Error(`Native connection is ${status}`));
      }),
    );
    await this.refresh();
    if (this.current === undefined || this.current.status !== 'open')
      throw new Error('Exposed provider is unavailable');
  }

  snapshot(): ProviderCatalogSnapshot | undefined {
    return this.current;
  }

  subscribe(listener: (snapshot: ProviderCatalogSnapshot | undefined) => void): () => void {
    if (this.signal.aborted) {
      this.notify(listener);
      return () => {};
    }
    this.listeners.add(listener);
    this.notify(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  report(cause: unknown): void {
    const error = cause instanceof Error ? cause : new Error('Remote catalog failed', { cause });
    try {
      if (this.options.report === undefined) console.error('[devkit/devframe/client]', error);
      else this.options.report(error);
    } catch {
      /* Observer failures cannot prevent cleanup. */
    }
  }

  private notify(listener: (snapshot: ProviderCatalogSnapshot | undefined) => void): void {
    try {
      listener(this.current);
    } catch (cause) {
      this.report(cause);
    }
  }

  private publish(snapshot?: ProviderCatalogSnapshot): void {
    this.current = snapshot;
    const listeners = [...this.listeners];
    for (const listener of listeners) if (this.listeners.has(listener)) this.notify(listener);
  }

  private invalidate(): void {
    if (this.signal.aborted) return;
    this.revision += 1;
    this.publish();
    void this.refresh().catch((cause: unknown) => {
      this.report(cause);
    });
  }

  private refresh(): Promise<void> {
    if (this.pending !== undefined) return this.pending;
    const pending = this.read();
    this.pending = pending;
    const finished = () => {
      this.pending = undefined;
    };
    void pending.then(finished, finished);
    return pending;
  }

  private async read(): Promise<void> {
    while (!this.signal.aborted) {
      const revision = this.revision;
      const value = await waitForNative(
        nativeCall(this.options.rpc, catalogMethod(this.options.providerId), []),
        this.signal,
      );
      this.signal.throwIfAborted();
      if (revision !== this.revision) continue;
      const snapshot = captureCatalog(value);
      if (snapshot !== undefined) this.assertIdentity(snapshot.provider);
      this.publish(snapshot);
      return;
    }
    this.signal.throwIfAborted();
  }

  private assertIdentity(provider: ProviderDescriptor): void {
    if (provider.id !== this.options.providerId || provider.realm.id !== this.options.realm.id)
      throw new Error('Native catalog belongs to a different provider');
    if (this.identity === undefined) {
      this.identity = provider;
      return;
    }
    if (provider.incarnation === this.identity.incarnation) return;
    const error = new Error(
      'Provider incarnation changed; create a fresh connection and attachment',
    );
    this.dispose(error);
    throw error;
  }

  dispose(reason: unknown = new Error('Provider connection is disposed')): void {
    if (this.signal.aborted) return;
    this.cancellation.abort(reason);
    for (const unsubscribe of this.cleanup.splice(0)) unsubscribe();
    this.publish();
    this.listeners.clear();
  }
}
