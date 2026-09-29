import type { ProviderRpcClient } from './types.js';
import { catalogChanged } from '../rpc-contract.js';

interface CatalogEvents {
  readonly listeners: Set<() => void>;
  failed: boolean;
}

const clients = new WeakMap<object, CatalogEvents>();

/** The native client owns one retained definition; each adapter owns only its subscription. */
export function onCatalogChanged<Context>(
  rpc: ProviderRpcClient<Context>,
  listener: () => void,
): () => void {
  let events = clients.get(rpc.client);
  if (events === undefined) {
    if (rpc.client.definitions.has(catalogChanged))
      throw new Error(`Native client method is already registered: ${catalogChanged}`);
    events = { listeners: new Set(), failed: false };
    clients.set(rpc.client, events);
    const registered = events;
    try {
      rpc.client.register({
        name: catalogChanged,
        type: 'event',
        args: [] as const,
        handler() {
          const listeners = [...registered.listeners];
          for (const callback of listeners) if (registered.listeners.has(callback)) callback();
        },
      });
    } catch (cause) {
      registered.failed = true;
      throw cause;
    }
  }
  if (events.failed) throw new Error('Catalog registration failed; recreate the native client');
  events.listeners.add(listener);
  return () => {
    events.listeners.delete(listener);
  };
}
