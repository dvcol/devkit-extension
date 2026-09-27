# Provider routing client

`@devkit/client` selects among adapter-owned provider connections and delegates execution to them. It has no framework, Node, browser-extension or native transport dependency. `@devkit/core` supplies its public contracts. The client owns connection attachments and cancellation; adapters retain authentication, transport and backend resources.

## Composition and calls

Both `@devkit/server` handles implement `ProviderConnection` directly:

```ts
import { createClient } from '@devkit/client';

const client = createClient({
  connections: [devframeProvider, devtoolsProvider],
  routing: [
    { realm: 'devserver', provider: 'frontend' },
    { realm: 'devserver', provider: 'tools' },
  ],
});

const result = await client.actions.invoke({ action, input });
const value = await client.capabilities.invoke({ capability, operation: 'read', input });
const resolution = await client.capabilities.resolve({ capability });
if (resolution.status === 'available') {
  await resolution.binding.api.read(input);
}
```

Each invocation keeps the descriptor's input/output types, operation correlation and required-target constraint. Bound operations accept `input, options`, where options contain cancellation and target metadata. Their owner never changes. Target metadata is copied at the call boundary; adapters must still validate authority and freshness.

| API                                                                            | Ownership and behavior                                                                                                                  |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `createClient({ connections?, routing?, report? })`                            | Attaches existing connections and installs an optional client default. `report` receives observer errors; calls reject to their caller. |
| `client.providers.attach({ connection })`                                      | Returns an idempotent `detach()` handle. Duplicate `(realm, provider ID)` registrations throw, including the same instance.             |
| `client.providers.snapshot()` / `.subscribe(listener)`                         | Immutable identity/status snapshots, immediate subscription and updates. `unknown` means the adapter has not synchronized its catalog.  |
| `client.actions.invoke(request)` / `client.capabilities.invoke(request)`       | Select one provider before dispatch and return its typed value. No retry or rerouting after dispatch.                                   |
| `client.capabilities.resolve(request)`                                         | Resolve a binding pinned to the selected attachment and incarnation.                                                                    |
| `client.actions.broadcast(request)` / `client.capabilities.broadcast(request)` | Explicit recipient union with per-provider fulfilled/rejected outcomes.                                                                 |
| `client.dispose()`                                                             | Aborts client-owned work, detaches connections and unsubscribes observers. Does not dispose providers or close their hosts.             |

## Selection

Per-call `routing` replaces the action contract default, which replaces the client default. With no policy, exactly one available provider must satisfy the contract. Selectors require a non-empty string `realm` and optional string `provider` scoped to that realm. IDs are compared exactly, without normalization.

An ordered list is pre-dispatch fallback. Each group considers open providers with a synchronized catalog, the exact contract version and an active contribution. Zero eligible providers advances to the next group; multiple eligible providers reject with `ambiguous-provider`, requiring the caller to select one. There is no discovery-order tie-breaker or implicit wait. An active catalog entry does not establish target authorization or permission.

Local routing callbacks support a picker or application policy:

```ts
await client.actions.invoke({
  action,
  input,
  signal,
  routing: async ({ candidates, target, signal: selectionSignal }) => {
    return chooseProvider({ candidates, target, signal: selectionSignal });
  },
});
```

The callback receives immutable candidate identities/availability, the ordinary `input` as `unknown`, optional copied target metadata and an abort signal. It returns a selector or ordered list. Its candidate owners are fixed for that invocation. Readiness is checked again for those same owners when the callback completes. A selected attachment that was detached/replaced rejects with `stale-selection`; a new invocation can select its successor. Unrelated new attachments do not enter a waiting callback's candidate set. Cancellation stops waiting and late callback completion cannot dispatch. Callback exceptions propagate unchanged. Code stays local and is never advertised or serialized by this package.

## Broadcast preflight

```ts
const outcomes = await client.actions.broadcast({
  action,
  input,
  selection: [{ realm: 'devserver', provider: 'frontend' }, { realm: 'webext' }],
});
```

`selection` must be a non-empty list. It forms a union, deduplicated by attached provider incarnation. Broadcast rejects any `routing` property and inherits no action/client routing default.

Every selector must match at least one known provider before any dispatch. If one is unmatched, the entire promise rejects with `RoutingError`, code `unmatched-selection`, and all unmatched selectors in `.selectors`. The message identifies them and asks the caller to refresh discovery or correct selection. This includes an empty registry. No recipient runs on that error.

Known providers with an unknown catalog, unavailable contract or disconnected lifecycle still belong to the recipient set and produce rejected outcomes. Other recipients can succeed. Calls run concurrently; results use attachment order, which conveys no priority. Cancellation after dispatch also leaves individual outcomes. This is not a transaction: cancellation or an error does not prove a side effect did not occur, and nothing is replayed automatically.

## Connection requirements and evidence

A `ProviderConnection` supplies its provider identity, catalog snapshot/subscription, `resolve` and `invoke`. Its identity stays fixed; replace an attachment for a new incarnation. An undefined catalog is unsynchronized; an empty catalog is authoritative absence. The adapter must authorize advertised metadata for its principal, validate target freshness, enforce contracts, reject lost transports and honor request cancellation. The router cannot establish those guarantees from a catalog alone. Native context access remains whatever the selected adapter actually owns and exposes.

The package tests execute actual local providers and exercise ambiguity, defaults, exact selection, callback races, cancellation, stale bindings, ownership and broadcast preflight. The [two-server example](../../examples/server-contexts/README.md) routes through genuine local Devframe hub and DevTools kit handles with separate native shared state. The packed consumer checks TypeScript Bundler/NodeNext imports and a portable browser bundle.

The [native remote adapter](../server/README.md) supplies authenticated catalog synchronization and target-free RPC through an existing Devframe/DevTools client. Its accepted cancellation behavior stops the local wait while dispatched backend work may finish. Native catalog authorization controls metadata visibility; native method authorization still controls each call. Endpoint discovery, target authority and WebExtension integration remain unfinished. `RoutingError` and callback errors are local values; a wire error policy remains adapter work.
