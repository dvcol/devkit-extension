# @devkit/devframe

Portable provider registration and catalog synchronization over native Devframe RPC. This private package contains the implementation previously owned by `@devkit/server`, shared with the WebExtension host. It creates no transport, authentication system, codec, store or renderer.

The server adapter keeps its existing public factories. A host composing native RPC directly can supply the same dependencies:

```ts
import { createRpcProvider } from '@devkit/devframe';

const provider = await createRpcProvider({
  context: { rpc, realm, execution, native },
  providerId: 'example.backend',
  services: [counterService],
  plugins: [counterActionsPlugin],
  expose: { capabilities: [counterCapability], actions: [increaseCounterAction] },
});
```

`rpc` supplies the native collector's `register` and `has`, plus the native host's `broadcast`. Keep that object stable for its host lifetime. Its generic context preserves the collector's real setup context, including `undefined` in a worker. `realm`, `execution` and `native` are the existing portable descriptors and local native-context access. `services`, `plugins`, `strict`, `kinds`, `report`, startup handles and disposal retain the server adapter's semantics.

The host admits connections and owns RPC, state and browser/process resources. The provider owns its contribution installations. Exposed native methods remain fixed for that RPC host; replacement requires successful cleanup and receives a new incarnation. Retained methods reject unavailable implementations and stale incarnations. Native schemas validate calls and results.

## Connect an existing native client

```ts
import { createRpcProviderConnection } from '@devkit/devframe/client';
import { createClient } from '@devkit/client';

const connection = await createRpcProviderConnection({
  rpc: { call: rpcClient.$call, client: collector, events },
  realm,
  providerId: 'example.backend',
});
const client = createClient({ connections: [connection] });
```

The raw composition supplies existing native members. `events` is Devframe's `RpcClientEvents` emitter, also used by its shared-state host. On Port disconnection the owner calls `$close()` and emits native `connection:status` with `disconnected`; the [extension example](../../examples/webext/README.md) shows this ownership. The authenticated high-level server client already supplies those fields and events. Its wrapper rejects static connections, and the shared adapter retains native cache checks when that client has a cache manager.

`realm` is the expected realm from trusted host configuration. Advertised metadata must match it and `providerId` before attachment. A catalog query returns only explicitly exposed contracts. Payload-free invalidations trigger a new native query, and the adapter never puts authoritative catalog metadata in writable shared state.

`signal?` cancels startup only. Connection disposal or a native disconnect clears availability and stops local waits without closing the caller's native resources. A dispatched operation may still finish; neither the connection nor router replays it. The same live backend keeps its incarnation across UI reconnects. A replaced backend requires a fresh connection and attachment.

## Bind native JSON actions to the portable client

```ts
import { createActionCall } from '@devkit/devframe/client';

const rendererContext = {
  rpc: {
    ...nativeRpc,
    call: createActionCall({
      rpc: nativeRpc,
      actions: client.actions,
      bindings: [
        {
          action: increaseMatchingCounterAction,
          selection: [{ realm: 'devserver' }, { realm: 'webext' }],
        },
        { action: increaseCounterAction, routing: { realm: 'webext' } },
      ],
      signal: viewLifetime.signal,
    }),
  },
};

// Inside an ordinary native JSON Button definition:
const on = {
  press: {
    action: increaseMatchingCounterAction.id,
    params: { domain: { $state: '/domain' }, amount: 1 },
  },
};
```

Pass `rendererContext` to the unchanged native renderer. The binding uses the imported action ID and contract version. `params` is the action's single input; existing provider validation checks it. An explicit `selection` broadcasts and returns the router's per-provider outcomes. A binding with `routing`, or neither property, uses ordinary invocation and its existing defaults. Duplicate action IDs, including different versions of the same ID, and conflicting selection/routing fail at setup.

Only explicitly bound IDs change dispatch. Unrelated native calls keep their arguments, receiver and result. Native renderer built-ins execute before this boundary. Keep native shared state and connection metadata, including static-backend metadata; this helper only replaces `call`. The host owns selection changes, outcome presentation and view disposal. Aborting its signal forwards cancellation through the existing router and adapters; it does not close native connections, roll back backend work or replay commands. Direct TypeScript callers continue to use `client.actions` for typed portable inputs/results. Native `call` retains its upstream signature; no portable methods are added to the global native RPC type registry.

The [WebExtension example](../../examples/webext/README.md#native-json-actions-across-providers) supplies the live application composition. Domain applicability is ordinary action implementation code in the contribution example; the binding contains no domain policy.

## Evidence and limits

- Native collector tests cover schema validation, retained definitions, replacement and raw-client typing.
- The server suite runs both native hosts, authenticated sockets, native cache/authorization checks, lifecycle failures and a client mixing an authenticated WebSocket backend with a JSON Port backend under the same logical provider ID in different realms.
- WebExtension MessageChannel tests cover both JSON and structured-clone delivery, two providers, independent clients, ambiguity, selection, broadcast, catalog changes, expected-realm rejection and replacement.
- The maintained Chromium and Firefox example verifies actual runtime Ports, the native renderer, mixed native backends and selected-page connections. Its browser builds reject Node imports.
- `pnpm artifacts:native` checks installed tarballs under strict Bundler and NodeNext resolution, executes both server factories and Port RPC composition, and bundles the browser consumer without workspace source imports.

Native JSON action dispatch across providers has maintained Chromium and Firefox acceptance tests. Provider view discovery/composition, the full renderer catalog and the complete conformance inventory remain separate work. The workspace and isolated native consumer explicitly install the pinned upstream patches documented in [the patch inventory](../../patches/README.md); those patches do not propagate automatically to published consumers.
