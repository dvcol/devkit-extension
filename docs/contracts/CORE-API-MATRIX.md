# Core API proof matrix

Required implementation evidence for [ARCHITECTURE.md](../../ARCHITECTURE.md) and [core declarations](./core.d.ts). Example/test names are planned obligations, not claims that those applications or runtime tests exist today.

Host codes: **DF** standalone Devframe, **DT** Vite DevTools, **CH** Chromium extension, **FF** Firefox extension. Each runtime row applies to all four unless it names a native restriction. The renderer-independent example also runs with the renderer absent. Target-bearing rows run against real target/document generations.

| Public exports or hooks | Example/fixture | Required assertions |
| --- | --- | --- |
| `defineRealm`, `RealmDescriptor`; `defineExecution`, `ExecutionDescriptor`; `ProviderDescriptor`, `ContextMetadata` | `examples/custom-realm`; `contracts/context-types` | New realm/execution IDs preserve literal types; no core switch/renderer change; provider identity remains separate; mandatory opaque incarnation identifies a backend lifetime and remains stable through client reconnect or ordinary HMR |
| `defineNativeContext`, `NativeContextDescriptor`, `NativeContextAccess.get`, `BindingContext` | `examples/native-context`; `contracts/context-types` | Correct local type or absent; remote `native` access fails compile; native objects never cross messages; unavailable APIs return absent on unsupported hosts |
| `defineOperation`, `OperationDefinition`, `OperationInput`, `OperationValue`, `TargetRequirement` | `examples/contribution`; `contracts/schema-inference` | Mandatory input/return validators and target mode; original-value inference including transforming schemas; reject invalid runtime input/return |
| `defineCapability`, `CapabilityDescriptor`, `CapabilityImplementation` | `examples/multi-version-service`; `contracts/implementation-types` | Mandatory numeric version and schemas; missing/wrong method types fail compile; exact versions coexist; changed schema under same version is invalid |
| `CapabilityApi`, `OperationArguments`, `OperationContext`, `InvocationOptions`, `RoutedInvocationOptions`, `TargetReference` | `examples/targeted-action`; `contracts/target-types` | Required target enforced; targetless call rejects target; target separate from payload; stale generation rejected; raw promise values preserved |
| `CapabilityClient.resolve`, `CapabilityResolution`, `CapabilityBinding`, `AvailabilityReason` | `examples/routing`; `runtime/availability` | Correct provider/context; each availability cause; binding provider does not silently change; call-time races still fail explicitly |
| `CapabilityClient.invoke`, `ActionClient.invoke`, `RoutingDirective` boundary | `examples/routing`; `runtime/call-routing` | Select before dispatch; exact pin/default precedence; no rerouting after timeout/disconnect; ordinary errors reject; broadcast obligations finalized in routing ticket |
| `defineService`, `ServiceDeclaration`, `ServiceDefinition`, `SetupContext`, `CapabilityRequirements`, `RequirementBindings` | `examples/contribution`; `runtime/service-installation` | Same startup/runtime recipe; exact requirement inference; undeclared services fail compile; native setup location correct; no renderer needed |
| `defineActionContract`, `ActionDescriptor`; `defineAction`, `ActionDeclaration`, `ActionDefinition` | `examples/contribution`; `contracts/action-types` | Public descriptor imports no handler; handler signatures inferred; required capabilities share selected provider; explicit orchestration only |
| `definePlugin`, `PluginInput`, `PluginDefinition`, `ContributionDeclaration` | `examples/plugin-composition`; `runtime/admission` | Dedicated properties, wrong-kind/misspelled property errors; strict batch atomic preflight; deterministic conflicts; independent setup failure isolation |
| `defineContributionKind`, `ContributionKindDescriptor`, `defineExtension`, `ExtensionDefinition`, `ContributionKindInstaller.activate` | `examples/custom-kind`; `runtime/custom-kind` | Payload schema/type; explicit installer; unknown-kind error; owned setup/teardown; duplicate and failure policy same as core |
| `DefinitionInstallationApi.install`, `InstallationResult` | `examples/dynamic-installation`; `runtime/admission` | Admitted vs skipped explicit; strict errors before setup; existing owner unchanged; no pointer exception; skipped registration gets no handle |
| `InstallationHandle.snapshot`, `InstallationSnapshot`, `ContributionSnapshot` | `examples/lifecycle-status`; `runtime/lifecycle-status` | Ready/partial/inactive accurate; late UI sees failures; generation/availability/diagnostics remain observable without invoking operations |
| `InstallationHandle.subscribe`, `Unsubscribe` | `examples/lifecycle-status`; `runtime/subscriptions` | Initial/current snapshot, transitions, listener failure isolation; idempotent unsubscribe and no notifications/leaks after removal |
| `InstallationHandle.enable`, `.disable`, `.retry` | `examples/lifecycle-status`; `runtime/reactivation` | Disable survives capability restoration; automatic restoration only when enabled; setup errors require explicit retry; retry cannot bypass cleanup-blocked state |
| `ActivationScope.signal`, `.onDispose`; `Awaitable` | `examples/resource-owner`; `runtime/cleanup` | Sync/async cleanup, reverse order, all callbacks attempted; cancellation; delayed setup completion fenced; no activation after incomplete cleanup |
| `InstallationHandle.dispose`, `DefinitionInstallationApi.replace` | `examples/replacement`; `runtime/replacement` | Repeated dispose one attempt; invalid replacement preserves old installation; successor only after cleanup; reject/hang blocks; verified reset recovery owned by adapter |
| `RuntimeDiagnostic`, `OperationError`, `isOperationError` | `examples/failure-view`; `runtime/errors` | Stable portable codes, validated narrowing, original error remains local, logs plus current/later UI, independent status presentation; no assumption of native error prototype transport |

## Cross-cutting gates

- `contracts/client-imports`: emitted client graph contains no provider handler, Node-only dependency or mandatory UI framework.
- `runtime/two-providers`: simultaneous providers/versions remain separately owned; state and native contexts never merge; equal configured IDs with different backend incarnations never retarget an existing binding.
- `hosts/lifecycle`: real worker restart, panel closure, navigation, reconnect and permission transitions exercise their supported operations and explicit unsupported states.
- `hosts/modes`: development and built-asset live preview/release paths receive separate assertions; source HMR is not proof of preview behavior.
- `examples/custom-renderer`: replace the renderer through public interfaces and repeat action/state/error behavior without modifying contributions.
- `contracts/negative`: exact missing/wrong implementations, version-less definitions, missing targets, undeclared dependencies, incorrect custom-kind payloads, unknown plugin properties and remote-native access are compiler errors.

View, script, transform, state, debugger and native adapter-specific helpers/hooks receive additional rows from their domain tickets before implementation admission. The matrix cannot count a declaration-only type check or browser mock as a successful real-host runtime cell.

## Local implementation evidence

The maintained `packages/core` source implements the 61 reviewed exports. Its 12 runtime functions are tested in `packages/core/tests/definitions.test.ts`, `invalid-definitions.test.ts`, `snapshots.test.ts` and `errors.test.ts`; the 28 negative compile fixtures live in `packages/core/tests/core.type-test.ts`. Consult actual package files for the current test inventory. These are local contract checks, not four-host conformance.

`packages/runtime/tests/admission.test.ts` exercises whole-batch rollback, service duplicate strictness, exact versions, waiting-service cycles, unknown kinds and mutable-alias isolation. `invocation.test.ts` exercises guard-only schema validation, targets, cancellation, errors and target capture across asynchronous validation. `scope.test.ts`, `activation.test.ts` and `activation-cancellation.test.ts` exercise reverse cleanup, in-progress setup/call settlement, blocked cleanup, late completion fencing and idempotent ownership termination.

The local provider controller adds executable installation handles and dependency reconciliation. `provider-lifecycle.test.ts` covers dependency order and restoration, explicit disable/retry, snapshots and listener isolation. `provider-contracts.test.ts` covers strict/relaxed admission, version/execution availability, custom-kind validation and cleanup, registered schema authority and prototype-shaped names. `provider-cancellation.test.ts` covers cancellation during setup and calls, dependency teardown and reentrant abort listeners. `provider-replacement.test.ts` and `provider-admission-transactions.test.ts` cover successor preflight, retained ownership during cleanup, disjoint admission and dependency-cycle checks across replacement generations.

`provider-identity.test.ts` verifies immutable provider identity in setup, bindings and operation contexts, distinct backend incarnations under the same configured ID, and stale bindings rejecting after their original controller is disposed. It also checks that asynchronous input validation cannot observe a later mutation of the supplied provider identity.

The maintained `examples/contribution` executes a real local service and action without a renderer, using separate public contract and provider entry points. Its five integration tests exercise successful calls, later dependency installation, visible setup failure, disable/dispose cleanup and validation before mutation. The demo imports built package exports and observes its actual subscription count reaching zero on disposal. This is a custom local realm; it is not a substitute for any DF/DT/CH/FF cell above.

The maintained [`examples/server-contexts`](../../examples/server-contexts/README.md) reuses the same public descriptors with real Devframe hub and DevTools kit contexts. Its executable check consumes built exports. The 11 integration tests in [`packages/server/tests`](../../packages/server/tests) provide the additional adapter assertions below.

| Implemented API | Example and automated evidence | Proven scope |
| --- | --- | --- |
| `installDevframeProvider`, `installDevToolsProvider`, `ServerComposition` | Both server demos; server integration and ownership tests | Genuine local contexts; strict/relaxed startup, ordered handles and one installation per context |
| `serverRealm`, `serverExecution`, native context descriptors | Both server demos; server integration tests | Shared devserver realm; actual layered native objects; kit absent for hub installer; no fabricated Vite server |
| `ServerProviderHandle.resolve` / `.invoke` | Both demos and executable check; server integration tests | Same portable action/capability descriptors; real native shared state; local validated calls |
| `.services`, `.plugins`, `.startup` | Both demos; integration and ownership tests | Dynamic installation, waiting action, disable/enable, replacement, failed setup and observable cleanup failure |
| Custom kinds and diagnostic sink | Server extension integration tests | Actual native command registration/disposal; local causes and default warning output |
| `.dispose()` and incarnation | Both demos; ownership tests | Retained host state, removed owned commands, unrelated commands/HTTP survive, fresh incarnation after successful reinstall, failed cleanup blocks replacement |

This table records headless local server integration only. The maintained [`examples/vite-hosts`](../../examples/vite-hosts/README.md) adds twelve tests against the actual `@devframes/vite/hub` and `@vitejs/devtools` Vite plugins: native HTTP metadata and contexts, the shared counter action, awaited delayed cleanup, incarnation changes and stale bindings on restart, observable failed cleanup on close, close-before-listen, watched config replacement, and client-module invalidation that retains backend identity/state. Tests consume built public exports and use real filesystem changes and loopback listeners.

These are partial DF/DT lifecycle cells, not complete host conformance. Failed-restart candidate cleanup, failed native setup, preview, bundled dev, browser-side HMR delivery, remote SDK transport, authentication and browser UI need separate evidence. No Chromium/Firefox extension cell is satisfied by these tests.

Provider routing, state, transport, real-host lifecycle and the complete API-to-example catalogue remain required. View, script and transform entries still need domain-specific implementation. Do not infer supported host cells from these local controller tests.
