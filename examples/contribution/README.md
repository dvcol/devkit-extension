# UI-free contribution example

This example executes one shared counter capability and one action through the real local provider lifecycle controller. It uses `@devkit/core` declarations, Standard Schema validation with Zod, and the private `@devkit/runtime` adapter internals. It has no renderer or frontend framework.

`src/index.ts` exports only capability and action contracts. It imports neither provider handlers nor the runtime implementation. `src/provider.ts`, available through the separate `./provider` entry point, contains the service recipe and action plugin. The Node-only runner is `src/demo.ts`.

The service obtains a `MemoryCounter` through a typed local native-context descriptor. Its activation owns a real subscription to that source. Reads observe source changes; disabling or disposing the service removes the subscription. The action calls the same capability through a declared service requirement. The in-memory resource demonstrates ownership; it is not a generic shared-state or persistence API.

## Run

From the repository root, install the pinned workspace dependencies and build this example's dependency graph:

```sh
pnpm install --frozen-lockfile
pnpm --filter @devkit/example-contribution... run build
pnpm --filter @devkit/example-contribution run demo
```

The demo uses Node's TypeScript execution and built workspace-package exports. It prints an action result of `3`, a capability read of `3`, one active subscription, and zero subscriptions after disposal. Use the Node version required by the repository.

```sh
pnpm --filter @devkit/example-contribution run test
pnpm --filter @devkit/example-contribution run typecheck
pnpm --filter @devkit/example-contribution run lint
pnpm --filter @devkit/example-contribution run format:check
```

The tests execute real recipes and provider operations. They cover successful action/capability calls, a waiting plugin activated by later service installation, current setup-failure diagnostics, disable/dispose cleanup, old binding rejection, and validation before mutation. No mocked provider or compile-only behavior supplies those results.

## Proof boundary

This is a local adapter-ownership example. It does not prove Devframe integration, Vite DevTools integration, a JSON renderer, browser content/background execution, a DevTools panel, a popup, or a browser sidebar. Those hosts and their failure, permission, reload and lifecycle paths remain required examples under issue #14. It also does not complete the full public-API-to-example-to-test inventory.

The private lifecycle controller composes activation scopes: cancellation waits for owned work before teardown, and failed cleanup blocks completion. A future public host factory may wrap these internals. The example's custom `example.local` realm denotes this local demonstration only; it does not claim an implemented extension or server host.
