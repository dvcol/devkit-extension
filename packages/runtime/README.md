# Adapter runtime internals

This private package implements shared admission, operation validation and activation ownership for provider adapters. It does not provide RPC, shared state, provider routing or a host constructor. Adapters must reuse their native transport and state implementations.

- `createAdmissionRegistry` reserves a complete startup composition synchronously, in host-service then plugin order. Strict conflicts roll back the incoming batch. Relaxed service duplicates produce skipped results without an ownership handle. A plugin can retain independent contributions and its skip diagnostics. Existing and incoming service dependencies are checked together for cycles. Only the original reservation can release its slots.
- `createActivation` owns one generation of setup, calls and teardown. Stop fences new calls, cancels setup and existing calls, waits for their actual settlement, then disposes resources. Late values cannot reactivate the generation. Setup and cleanup failures remain distinct local status.
- `createActivationScope` aborts immediately on disposal, runs all registered cleanups serially in reverse acquisition order and retains the same terminal promise. Cleanup errors aggregate; pending cleanup stays pending. Registering cleanup after disposal starts fails.
- `invokeLocalOperation` checks target presence and validates input and return values without substituting schema transformations. Cancellation is checked before dispatch and after asynchronous boundaries. Dispatched work is never rerouted or replayed. Cancellation does not pretend that an uncooperative handler has stopped; the returned promise stays pending until that work settles.

Targets must already be resolved, authorized and checked for freshness by the owning adapter. Schema validation is neither authorization nor serialization. Native objects and causes remain local. The adapter must expose classified failures through its diagnostics/status channel and appropriate local logging.

These internals do not yet implement dependency reconciliation, installation handles, replacement, native kind activation, startup setup, or transport behavior. Adapters must compose `createActivation` with their registrations so no resource cleanup races in-progress setup or calls. Calling the lower-level scope alone cannot establish that those operations ended. The core proof matrix remains incomplete until these contracts execute in real hosts.

From the repository root, build the core dependency before using this package:

```sh
pnpm --filter @devkit/core build
pnpm --filter @devkit/runtime typecheck
pnpm --filter @devkit/runtime lint
pnpm --filter @devkit/runtime format:check
pnpm --filter @devkit/runtime test
pnpm --filter @devkit/runtime build
```
