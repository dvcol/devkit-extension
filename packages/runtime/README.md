# Adapter runtime internals

This private package implements admission, dependency reconciliation, operation validation and activation ownership for provider adapters. It does not provide RPC, shared state, provider routing or a public host constructor. Adapters must reuse their native transport and state implementations.

`createProviderLifecycle` composes these mechanisms for one provider and execution context. Its caller supplies the provider descriptor, execution descriptor, typed local native-context access, optional custom-kind installers, strictness and a diagnostic sink. The sink can receive a local cause separately; portable diagnostics and snapshots never include that native value.

| Method                                        | Behavior                                                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `startup({ services, plugins })`              | Snapshot and preflight the whole composition before running setup. Return admitted handles or explicit relaxed skips in input order.    |
| `services.install`, `plugins.install`         | Use the same definition and admission rules after startup. Waiting dependencies activate when their matching service becomes available. |
| `services.replace`, `plugins.replace`         | Validate a successor before retiring the current owner. Successor setup requires completed cleanup.                                     |
| `resolve({ capability })`                     | Return an availability result or a local binding for the exact capability ID and version.                                               |
| `invoke({ action, input, target?, signal? })` | Dispatch the registered action through its registered validators and local required services.                                           |
| `dispose()`                                   | Fence calls, cancel owned work, wait for actual settlement and dispose resources. Repeated calls retain the same terminal promise.      |

Admitted handles expose current snapshots, subscriptions, enable, disable, explicit setup retry and disposal. A disabled installation stays disabled when dependencies recover. Setup failures do not retry automatically or stop independent contributions. Failed cleanup blocks the affected ownership chain; neither a timer nor retry can declare it released. The host owns any verified process or browser-context reset.

Replacements run one at a time per provider. A pending replacement reserves its old and successor identities, while unrelated installations and active calls can continue. Admission checks dependency cycles against both possible service graphs. A relaxed skipped service replacement leaves the current service active.

The provider descriptor is snapshotted and frozen, including its mandatory opaque `incarnation`. The adapter creates that value once per backend lifetime; this controller never generates or rotates it. Setup, binding and operation contexts retain that identity. A binding closes over its original controller and cannot acquire a successor merely because the successor uses the same configured provider ID. Disposing the old controller makes its bindings unavailable.

The runnable [contribution example](../../examples/contribution/README.md) composes these APIs through built package exports and verifies real subscription cleanup.

The lower-level exports remain available to adapters that need to compose their own boundary:

- `createAdmissionRegistry` reserves a complete startup composition synchronously, in host-service then plugin order. Strict conflicts roll back the incoming batch. Relaxed service duplicates produce skipped results without an ownership handle. A plugin can retain independent contributions and its skip diagnostics. Existing and incoming service dependencies are checked together for cycles. Only the original reservation can release its slots.
- `createActivation` owns one generation of setup, calls and teardown. `cancel()` fences and aborts work immediately while retaining its resources. `stop()` additionally waits for actual work settlement and disposes resources. This lets dependency teardown cancel a service before waiting for its dependents, then keep service resources alive until those dependents finish. Late values cannot reactivate the generation. Setup and cleanup failures remain distinct local status.
- `createActivationScope` aborts immediately on disposal, runs all registered cleanups serially in reverse acquisition order and retains the same terminal promise. Cleanup errors aggregate; pending cleanup stays pending. Registering cleanup after disposal starts fails.
- `invokeLocalOperation` checks target presence and validates input and return values without substituting schema transformations. Cancellation is checked before dispatch and after asynchronous boundaries. Dispatched work is never rerouted or replayed. Cancellation does not pretend that an uncooperative handler has stopped; the returned promise stays pending until that work settles.

Targets must already be resolved, authorized and checked for freshness by the owning adapter. Schema validation is neither authorization nor serialization. Native objects and causes remain local. The adapter must expose classified failures through its diagnostics/status channel and appropriate local logging.

Service recipes, actions and registered custom contribution kinds execute locally. View, script and transform declarations retain an explicit `unsupported` waiting state until their domain contracts and adapters supply implementations. Calling a lower-level scope alone cannot establish that in-progress setup or calls ended. The core proof matrix remains incomplete until these contracts execute in real hosts.

From the repository root, build the core dependency before using this package:

```sh
pnpm --filter @devkit/core build
pnpm --filter @devkit/runtime typecheck
pnpm --filter @devkit/runtime lint
pnpm --filter @devkit/runtime format:check
pnpm --filter @devkit/runtime test
pnpm --filter @devkit/runtime build
```
