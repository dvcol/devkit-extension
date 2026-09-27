import { captureRouting } from './calls.js';
import { ActionRouter } from './action-router.js';
import { CapabilityRouter } from './capability-router.js';
import { ConnectionRegistry } from './registry.js';
import type { Client, ClientOptions } from './types.js';

export { RoutingError } from './errors.js';
export type { RoutingErrorCode } from './errors.js';
export type * from './types.js';

/** Compose native connection adapters without owning their host processes, authentication or state. */
export function createClient(options: ClientOptions = {}): Client {
  const registry = new ConnectionRegistry(options.report);
  const routing = captureRouting(options.routing);
  try {
    for (const connection of options.connections ?? []) registry.attach({ connection });
  } catch (cause) {
    registry.dispose();
    throw cause;
  }
  return Object.freeze({
    actions: new ActionRouter(registry, routing),
    capabilities: new CapabilityRouter(registry, routing),
    providers: Object.freeze({
      attach: (request) => registry.attach(request),
      snapshot: () => registry.snapshot(),
      subscribe: (listener) => registry.subscribe(listener),
    }),
    dispose: () => {
      registry.dispose();
    },
  } satisfies Client);
}
