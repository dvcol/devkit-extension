# @devkit/server

Private Node adapter for installing portable services and plugins into an existing Devframe hub or Vite DevTools kit context. It delegates admission, activation, calls and cleanup to `@devkit/runtime`. The native host remains responsible for its RPC, shared state, HTTP server and reload lifecycle.

## Install a service in a real native context

This example uses public package imports. The embedding application supplies the actual context created by `createHubContext`, `createKitContext`, or an upstream host setup callback. Zod supplies the operation's Standard Schema validators; the SDK does not require Zod specifically.

```ts
import { defineCapability, defineOperation, defineService } from '@devkit/core';
import {
  devframeHubContext,
  installDevframeProvider,
  installDevToolsProvider,
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

export function installInHub(context: DevframeHubContext) {
  return installDevframeProvider(context, composition);
}

export function installInDevTools(context: KitNodeContext) {
  return installDevToolsProvider(context, composition);
}
```

Choose the installer matching the actual context and retain its returned handle. Both functions settle after the initial activation pass. The same service declaration works in either host because a genuine `KitNodeContext` extends `DevframeHubContext`. This example uses native shared state directly; the adapter adds no state store or RPC server.

`ServerComposition` also accepts `plugins`, `strict`, explicit custom contribution-kind `kinds`, and an optional local `report(diagnostic, cause?)` sink. Strict admission is the runtime default. With `strict: false`, supported recoverable admission conflicts produce ordered skipped results. Native causes stay local; portable diagnostics and installation snapshots do not include them. Without a supplied sink, the adapter emits warnings/errors through the Node console.

## Handles and native resources

| Export or handle member                       | Behavior                                                                                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serverRealm`                                 | Shared realm descriptor with ID `devserver` for both installers.                                                                                            |
| `serverExecution`                             | Shared execution descriptor with ID `devkit.server`; use it when declaring server contributions.                                                            |
| `devframeContext`                             | `DevframeNodeContext` in both integrations.                                                                                                                 |
| `devframeHubContext`                          | `DevframeHubContext` in both integrations.                                                                                                                  |
| `devToolsContext`                             | Actual `KitNodeContext` for the kit installer; absent for the hub installer. Optional `viteServer` and `viteConfig` remain optional on that native context. |
| `provider`                                    | Frozen descriptor containing the configured stable ID, shared realm and a fresh UUID `incarnation` for this installation lifetime.                          |
| `startup.services` / `startup.plugins`        | Ordered admitted/skipped results for the original composition. Admitted handles expose current status, diagnostics and lifecycle controls.                  |
| `services` / `plugins`                        | Runtime installation and replacement APIs for additional definitions.                                                                                       |
| `resolve({ capability })`                     | Local capability resolution. An available binding exposes its typed `api` and local context.                                                                |
| `invoke({ action, input, target?, signal? })` | Local typed action invocation, including the core operation's target/signal requirements.                                                                   |
| `dispose()`                                   | One retained promise for cleanup of this adapter's owned contributions.                                                                                     |

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

This is currently a local integration package. It does not publish provider discovery, bind portable calls to a remote transport, implement a client router, render a UI, or install Vite reload/close hooks. The [native Vite examples](../../examples/vite-hosts/README.md) provide example-local lifecycle wiring and real server/config-watcher tests for both released hosts. Their failure, preview and browser-HMR limitations remain explicit; this package does not yet expose a general Vite integration API.

The package is private and relies on the repository's exact-version declaration patches and dependency metadata for the released Devframe/hub/kit graph. The `devframe@1.0.0` patch also backports opt-in RPC connection isolation from [Devframe draft PR 401](https://github.com/devframes/devframe/pull/401). SDK-owned browser connections use `connection: { isolated: true }` when discovering an endpoint, or set `isolated: true` on a complete `DevframeConnection`. The returned descriptor retains the setting, so reconnecting with `{ connection }` keeps credentials local without another flag. Omitting `isolated` or setting it to `false` preserves shared behavior.

The patch changes the installed `devframe/client` artifacts. Prebuilt hub UI bundles contain their own RPC code and are unaffected. Root pnpm patches do not propagate to a published SDK's consumers; distribution still requires an upstream release or an explicit consumer patch policy. The multi-provider routing adapter remains to be implemented.
