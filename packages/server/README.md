# @devkit/server

Private Node adapter for starting portable services and plugins into an existing Devframe hub or Vite DevTools kit context. It delegates admission, activation, calls and cleanup to `@devkit/runtime`. The native host remains responsible for its RPC, shared state, HTTP server and reload lifecycle.

## Start a provider in a real native context

This example uses public package imports. The embedding application supplies the actual context created by `createHubContext`, `createKitContext`, or an upstream host setup callback. Zod supplies the operation's Standard Schema validators; the SDK does not require Zod specifically.

```ts
import { defineCapability, defineOperation, defineService } from '@devkit/core';
import {
  devframeHubContext,
  createDevframeProvider,
  createDevToolsProvider,
  serverExecution,
} from '@devkit/server';
import type { ServerComposition } from '@devkit/server';
import type { DevframeHubContext } from '@devframes/hub/node';
import type { KitNodeContext } from '@vitejs/devtools-kit/node';
import { z } from 'zod';

const counterCapability = defineCapability({
  id: 'example.counter',
  version: 1,
  operations: {
    increment: defineOperation({
      input: z.number(),
      output: z.number(),
      target: 'none',
    }),
  },
});

const counterService = defineService({
  capability: counterCapability,
  id: 'example.counter-service',
  execution: serverExecution,
  async setup({ native, scope }) {
    const context = native.get(devframeHubContext);
    if (context === undefined) throw new Error('This service requires a hub');
    const state = await context.rpc.sharedState.get<{ value: number }>('example:counter', {
      initialValue: { value: 0 },
    });
    const command = context.commands.register({
      id: 'example:read-counter',
      title: 'Read counter',
      handler: () => state.value().value,
    });
    scope.onDispose(() => {
      command.unregister();
    });
    return {
      increment(amount) {
        state.mutate((current) => {
          current.value += amount;
        });
        return state.value().value;
      },
    };
  },
});

const composition = {
  providerId: 'example.devserver',
  services: [counterService],
} satisfies ServerComposition;

export function createInHub(context: DevframeHubContext) {
  return createDevframeProvider({ context, ...composition });
}

export function createInDevTools(context: KitNodeContext) {
  return createDevToolsProvider({ context, ...composition });
}
```

Choose the factory matching the actual context and retain its returned handle. Both functions settle after the initial activation pass. The same service declaration works in either host because a genuine `KitNodeContext` extends `DevframeHubContext`. This example uses native shared state directly; the adapter adds no state store or RPC server.

`ServerComposition` also accepts `plugins`, `strict`, explicit custom contribution-kind `kinds`, and an optional local `report(diagnostic, cause?)` sink. Strict admission is the runtime default. With `strict: false`, supported recoverable admission conflicts produce ordered skipped results. Native causes stay local; portable diagnostics and installation snapshots do not include them. Without a supplied sink, the adapter emits warnings/errors through the Node console.

## Plugins and remote exposure in the same startup call

The shared example starts its services, plugins and native RPC exposure together:

```ts
import { counterCapability, increaseCounterAction } from '@devkit/example-contribution';
import { counterActionsPlugin, counterService } from '@devkit/example-server-contexts';
import { createDevframeProvider } from '@devkit/server';

const provider = await createDevframeProvider({
  context,
  providerId: 'example.remote',
  services: [counterService],
  plugins: [counterActionsPlugin],
  expose: {
    actions: [increaseCounterAction],
    capabilities: [counterCapability],
  },
});
```

The application supplies its existing native `context`. `createDevToolsProvider` accepts the same object shape with an actual kit context. These factories replace the old two-argument `installDevframeProvider` / `installDevToolsProvider` exports. No separate exposure call is needed. Runtime installation remains available when adding a definition later.

`expose` contains contracts, not implementations. Unlisted contracts remain local. Each listed action and each listed capability operation gets a named native method with arguments `(expectedIncarnation, input)` and its original input/output Standard Schemas. The native host retains authentication, authorization, serialization and request correlation. The adapter adds no server, codec, agent dispatcher or mandatory trust callback.

Native method names use `devkit:` followed by a JSON-encoded identity tuple: `[providerId, "action", actionId, version]` or `[providerId, "capability", capabilityId, version, operationName]`. This is collision-safe naming for native RPC, not a new payload codec. For example, the counter action above is `devkit:["example.remote","action","example.counter.increase",1]`. Calls return the operation value directly. Methods use native action semantics and do not opt into result caching or agent-tool advertisement.

The method set belongs to the native host. Disabling/disposal changes implementation availability; definitions remain registered. A successor on the same context can reuse the same exposed contract set after successful cleanup and receives a new incarnation. Reordered exposure lists are equivalent. Changing the set requires a fresh native host. Omitting `expose` on a successor leaves retained methods unavailable. Existing schemas remain fixed for that contract version; incompatible schema changes require a new version and host declaration.

All names and target requirements are checked before native registration. Foreign method collisions and duplicate descriptors reject setup. Required-target operations reject with a clear unsupported-authority error. Definitions are unavailable until startup completes. Native registry observers can throw after insertion; such a failure leaves retained methods unavailable and requires a fresh host. The adapter does not claim atomic native rollback or mutate private registry internals.

Default strict startup arrays and later `install` / `replace` calls contain direct handles. Relaxed mode retains `{ status: 'admitted', handle }` or `{ status: 'skipped', diagnostic }`; a dynamic boolean strictness returns the union. Handles expose `snapshot`, `subscribe`, `enable`, `disable`, `retry` and `dispose`. A successfully admitted handle can still report waiting or failed contributions.

## Connect the shared client to an existing native browser client

The separate `@devkit/server/client` entry is browser-safe. It accepts the native `DevframeRpcClient`, including the compatible client returned by Vite DevTools. It opens no transport and owns no credentials.

```ts
import { createClient } from '@devkit/client';
import { createDevframeProviderConnection } from '@devkit/server/client';

const connection = await createDevframeProviderConnection({
  rpc, // Existing authenticated native client.
  providerId: 'example.remote',
});
const client = createClient({ connections: [connection] });
const value = await client.actions.invoke({
  action: increaseCounterAction,
  input: { amount: 1 },
});

client.dispose();
connection.dispose();
// The application still owns rpc.close() and backend lifetime.
```

`signal?` cancels connection startup locally. `report?(error)` receives background catalog/observer failures; the default reports through the browser console. Initial synchronization failures reject the factory. Capability bindings expose `context.access: 'remote'`, provider identity and execution metadata, with no raw backend handles. The shared client keeps existing routing, binding and broadcast behavior.

| Event                                   | Adapter behavior                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial connection                      | Register a native notification listener, read the authorized catalog, validate metadata, pin the provider incarnation. Reject unavailable or static backends. |
| Contribution change                     | Clear the cached snapshot immediately, then reread through native authorization. An invalidation during a query forces another read before publication.       |
| Provider replacement                    | Invalidate the old connection. The application creates and attaches a fresh connection; old bindings never select the successor.                              |
| Caller abort or client/adapter disposal | Stop local waiting. An already-dispatched backend operation may finish; no cancellation message, retry or replay is fabricated.                               |
| Native disconnect or lost trust         | Clear availability, cancel local waits and unsubscribe. The application owns native reconnection/authentication.                                              |
| Adapter disposal                        | Remove its listeners without closing native RPC, shared state or provider contributions.                                                                      |

The server adds one native query named `devkit:[providerId,"catalog"]`. It projects only explicitly exposed action/capability contracts. Native authorization of this query grants access to that metadata; each operation still passes its own native method authorization. The catalog is not a shared-state key and clients cannot write it. A payload-free `devkit:catalog:changed` notification carries no catalog or provider data. Its definition lives with the native client; disposed adapters leave no listener behind. No polling, custom RPC framing, schema downloads or state replication is added.

Metadata is validated and frozen on receipt. Imported descriptors remain the source of typed business calls. Native schemas validate the server call as before. Client-side native caching of catalog or effect methods is rejected, because it could retain stale availability or suppress an operation; the adapter does not clear application-owned caches. `expose: {}` still publishes an empty catalog, whereas omitted `expose` publishes nothing.

The [browser example](../../examples/server-contexts/README.md#browser-client) exercises the built package entry against both native hosts. Socket tests cover malformed metadata, denied credentials, stale refreshes, disable/enable, replacement, listener reuse, ownership and cancellation. Those Node tests supply `location` because the upstream browser client reads it; the interactive browser check uses the actual browser environment.

## Handles and native resources

| Export or handle member                              | Behavior                                                                                                                                                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serverRealm`                                        | Shared realm descriptor with ID `devserver` for both installers.                                                                                                                                                           |
| `serverExecution`                                    | Shared execution descriptor with ID `devkit.server`; use it when declaring server contributions.                                                                                                                           |
| `devframeContext`                                    | `DevframeNodeContext` in both integrations.                                                                                                                                                                                |
| `devframeHubContext`                                 | `DevframeHubContext` in both integrations.                                                                                                                                                                                 |
| `devToolsContext`                                    | Actual `KitNodeContext` for the kit installer; absent for the hub installer. Optional `viteServer` and `viteConfig` remain optional on that native context.                                                                |
| `provider`                                           | Frozen descriptor containing the configured stable ID, shared realm and a fresh UUID `incarnation` for this installation lifetime.                                                                                         |
| `catalog.snapshot()` / `catalog.subscribe(listener)` | Read-only local contract catalog derived from the provider lifecycle. Includes inactive contracts and their status; subscription returns an unsubscribe function.                                                          |
| `startup.services` / `startup.plugins`               | Ordered admitted/skipped results for the original composition. Strict mode returns handles directly; `strict: false` returns admitted/skipped outcomes. Handles expose current status, diagnostics and lifecycle controls. |
| `services` / `plugins`                               | Runtime installation and replacement APIs for additional definitions.                                                                                                                                                      |
| `resolve({ capability })`                            | Local capability resolution. An available binding exposes its typed `api` and local context.                                                                                                                               |
| `invoke({ action, input, target?, signal? })`        | Local typed action invocation, including the core operation's target/signal requirements.                                                                                                                                  |
| `dispose()`                                          | One retained promise for cleanup of this adapter's owned contributions.                                                                                                                                                    |

Unknown native descriptors return `undefined`. Native values are local objects, not serialized metadata. Realm membership alone does not create an optional resource.

## Ownership and failures

Only one adapter installation may own a given native context object at a time, across both entry points. The guard covers pending startup as well as active installations. It does not deduplicate distinct wrappers or transports.

The embedding application must await `provider.dispose()` before replacing that installation or closing its host. Contribution scopes cancel active work and own their registered cleanup through the runtime. Successful disposal releases the context guard; a subsequent installation gets a new incarnation while retaining its configured provider ID. Disposal never closes the supplied hub or HTTP server and does not erase host-owned shared state.

Strict invalid startup rejects before contribution setup. A rejected startup attempts disposal before rejection reaches the caller; if that cleanup also fails, both failures are retained in an `AggregateError`. Individual setup failures instead remain observable on admitted child handles, and missing dependencies remain waiting. These outcomes still return a provider handle so its lifecycle remains owned.

Failed cleanup rejects the retained disposal promise and keeps the context reserved. Calling dispose again returns that same promise without replaying cleanup. The adapter does not declare a timeout successful, create a replacement around blocked resources, or supervise process recovery.

## Validation and current limits

From the repository root, after the workspace dependencies are installed:

```sh
pnpm --filter @devkit/server... build
pnpm --filter @devkit/server typecheck
pnpm --filter @devkit/server lint
pnpm --filter @devkit/server format:check
pnpm --filter @devkit/server test
```

The build filter includes this package's workspace dependencies. The tests create genuine headless hub and kit contexts. They exercise native shared state, services/actions, waiting activation, replacement, custom kinds, setup/cleanup failure and ownership. One test opens an ephemeral loopback HTTP server and verifies it still responds after adapter disposal; restricted sandboxes may require permission for that listener. Tests close their own native hosts afterward.

This package supports local integration, explicit target-free native RPC exposure, authenticated remote catalog synchronization and a remote `ProviderConnection`. Endpoint discovery and authoritative remote targets remain unfinished. The owner accepts native unary cancellation behavior: local cancellation does not stop dispatched backend work. It does not render a UI or install Vite reload/close hooks. The [native Vite examples](../../examples/vite-hosts/README.md) provide example-local lifecycle wiring and real server/config-watcher tests for both released hosts. Their failure, preview and browser-HMR limitations remain explicit; this package does not yet expose a general Vite integration API.

The package is private and relies on the repository's exact-version declaration patches and dependency metadata for the released Devframe/hub/kit graph. The `devframe@1.0.0` patch also backports opt-in RPC connection isolation from [Devframe draft PR 401](https://github.com/devframes/devframe/pull/401). SDK-owned browser connections use `connection: { isolated: true }` when discovering an endpoint, or set `isolated: true` on a complete `DevframeConnection`. The returned descriptor retains the setting, so reconnecting with `{ connection }` keeps credentials local without another flag. Omitting `isolated` or setting it to `false` preserves shared behavior.

The patch changes the installed `devframe/client` artifacts. Prebuilt hub UI bundles contain their own RPC code and are unaffected. Root pnpm patches do not propagate to a published SDK's consumers; distribution still requires an upstream release or an explicit consumer patch policy. The local multi-provider router is implemented in `@devkit/client`; the native remote connection adapter is available through this package’s browser entry. Extension connections and target authority remain outstanding.
