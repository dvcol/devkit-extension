import type { ProviderConnection } from '@devkit/client';
import { RemoteCatalog } from './catalog.js';
import type { RemoteCatalogOptions } from './catalog.js';
import { RemoteConnection } from './connection.js';
import { waitForNative } from './native-call.js';

export interface DevframeProviderConnectionOptions extends RemoteCatalogOptions {
  /** Cancels startup locally; the native connection remains owned by its caller. */
  readonly signal?: AbortSignal;
}

export interface DevframeProviderConnection extends ProviderConnection {
  /** Remove adapter subscriptions and stop local waits. Does not close native RPC or provider work. */
  dispose(): void;
}

/** Adapt an existing Devframe client, including the native client supplied by Vite DevTools. */
export async function createDevframeProviderConnection(
  options: DevframeProviderConnectionOptions,
): Promise<DevframeProviderConnection> {
  options.signal?.throwIfAborted();
  const catalog = new RemoteCatalog(options);
  try {
    const startup = catalog.start();
    if (options.signal === undefined) await startup;
    else await waitForNative(startup, options.signal);
    return new RemoteConnection(catalog);
  } catch (cause) {
    catalog.dispose(cause);
    throw cause;
  }
}
