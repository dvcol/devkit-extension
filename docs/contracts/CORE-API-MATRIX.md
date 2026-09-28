# Core API proof matrix

Required implementation evidence for [ARCHITECTURE.md](../../ARCHITECTURE.md) and the maintained [core package](../../packages/core/README.md). The declaration probe in this directory is an archived review snapshot. Planned rows below are obligations; dated implementation sections record the evidence actually completed.

Host codes: **DF** standalone Devframe, **DT** Vite DevTools, **CH** Chromium extension, **FF** Firefox extension. Each runtime row applies to all four unless it names a native restriction. The renderer-independent example also runs with the renderer absent. Target-bearing rows run against real target/document generations.

| Public exports or hooks | Example/fixture | Required assertions |
| --- | --- | --- |
| `defineRealm`, `RealmDescriptor`; `defineExecution`, `ExecutionDescriptor`; `ProviderDescriptor`, `ContextMetadata` | `examples/custom-realm`; `contracts/context-types` | New realm/execution IDs preserve literal types; no core switch/renderer change; provider identity remains separate; mandatory opaque incarnation identifies a backend lifetime and remains stable through client reconnect or ordinary HMR |
| `defineNativeContext`, `NativeContextDescriptor`, `NativeContextAccess.get`, `BindingContext` | `examples/native-context`; `contracts/context-types` | Correct local type or absent; remote `native` access fails compile; native objects never cross messages; unavailable APIs return absent on unsupported hosts |
| `defineOperation`, `OperationDefinition`, `OperationInput`, `OperationValue` | `examples/contribution`; `contracts/schema-inference` | Mandatory input/return validators; original-value inference including transforming schemas; reject invalid runtime input/return |
| `defineCapability`, `CapabilityDescriptor`, `CapabilityImplementation` | `examples/multi-version-service`; `contracts/implementation-types` | Mandatory numeric version and schemas; missing/wrong method types fail compile; exact versions coexist; changed schema under same version is invalid |
| `CapabilityApi`, `OperationArguments`, `OperationContext`, `InvocationOptions`, `RoutedInvocationOptions` | `contracts/requests`; native applicability test | Operation/input correlation; domain-owned resource input; no universal target option; raw promise values preserved |
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
- `contracts/negative`: exact missing/wrong implementations, version-less definitions, missing required schema fields, undeclared dependencies, incorrect custom-kind payloads, unknown plugin properties and remote-native access are compiler errors.

View, script, transform, state, debugger and native adapter-specific helpers/hooks receive additional rows from their domain tickets before implementation admission. The matrix cannot count a declaration-only type check or browser mock as a successful real-host runtime cell.

## Local implementation evidence

The maintained `packages/core` source implements the reviewed contract exports. Its 12 runtime functions are tested in `packages/core/tests/definitions.test.ts`, `invalid-definitions.test.ts`, `snapshots.test.ts` and `errors.test.ts`; the negative compile fixtures live in `packages/core/tests/core.type-test.ts`. Consult actual package files for the current test inventory. These are local contract checks, not four-host conformance.

`packages/runtime/tests/admission.test.ts` exercises whole-batch rollback, service duplicate strictness, exact versions, waiting-service cycles, unknown kinds and mutable-alias isolation. `invocation.test.ts` exercises guard-only schema validation, cancellation, errors and asynchronous boundaries. `scope.test.ts`, `activation.test.ts` and `activation-cancellation.test.ts` exercise reverse cleanup, in-progress setup/call settlement, blocked cleanup, late completion fencing and idempotent ownership termination.

The local provider controller adds executable installation handles and dependency reconciliation. `provider-lifecycle.test.ts` covers dependency order and restoration, explicit disable/retry, snapshots and listener isolation. `provider-contracts.test.ts` covers strict/relaxed admission, version/execution availability, custom-kind validation and cleanup, registered schema authority and prototype-shaped names. `provider-cancellation.test.ts` covers cancellation during setup and calls, dependency teardown and reentrant abort listeners. `provider-replacement.test.ts` and `provider-admission-transactions.test.ts` cover successor preflight, retained ownership during cleanup, disjoint admission and dependency-cycle checks across replacement generations.

`provider-identity.test.ts` verifies immutable provider identity in setup, bindings and operation contexts, distinct backend incarnations under the same configured ID, and stale bindings rejecting after their original controller is disposed. It also checks that asynchronous input validation cannot observe a later mutation of the supplied provider identity.

The maintained `examples/contribution` executes a real local service and action without a renderer, using separate public contract and provider entry points. Its five integration tests exercise successful calls, later dependency installation, visible setup failure, disable/dispose cleanup and validation before mutation. The demo imports built package exports and observes its actual subscription count reaching zero on disposal. This is a custom local realm; it is not a substitute for any DF/DT/CH/FF cell above.

The maintained [`examples/server-contexts`](../../examples/server-contexts/README.md) reuses the same public descriptors with real Devframe hub and DevTools kit contexts. Its executable check consumes built exports. The 11 integration tests in [`packages/server/tests`](../../packages/server/tests) provide the additional adapter assertions below.

| Implemented API | Example and automated evidence | Proven scope |
| --- | --- | --- |
| `createDevframeProvider`, `createDevToolsProvider`, `ServerComposition`, `ServerExposure` | Both server demos; server integration and ownership tests | Genuine local contexts; strict/relaxed startup, ordered handles and one installation per context |
| `serverRealm`, `serverExecution`, native context descriptors | Both server demos; server integration tests | Shared devserver realm; actual layered native objects; kit absent for hub installer; no fabricated Vite server |
| `ServerProviderHandle.resolve` / `.invoke` | Both demos and executable check; server integration tests | Same portable action/capability descriptors; real native shared state; local validated calls |
| `.services`, `.plugins`, `.startup` | Both demos; integration and ownership tests | Dynamic installation, waiting action, disable/enable, replacement, failed setup and observable cleanup failure |
| Custom kinds and diagnostic sink | Server extension integration tests | Actual native command registration/disposal; local causes and default warning output |
| `.dispose()` and incarnation | Both demos; ownership tests | Retained host state, removed owned commands, unrelated commands/HTTP survive, fresh incarnation after successful reinstall, failed cleanup blocks replacement |
| `ProviderCatalog.snapshot` / `.subscribe`; `ProviderCatalogSnapshot`, `CatalogCapability`, `CatalogAction`, `CatalogContract`, `CatalogOperation` | Contribution demo; `provider-catalog.test.ts`; native server integration tests; packed consumer | Authoritative local metadata, exact versions, immediate/change notifications, immutable snapshots, dependency transitions, replacement, unsubscribe, cleanup failure and disposal. No remote synchronization or target authorization claim. |

This table records headless local server integration only. The maintained [`examples/vite-hosts`](../../examples/vite-hosts/README.md) adds twelve tests against the actual `@devframes/vite/hub` and `@vitejs/devtools` Vite plugins: native HTTP metadata and contexts, the shared counter action, awaited delayed cleanup, incarnation changes and stale bindings on restart, observable failed cleanup on close, close-before-listen, watched config replacement, and client-module invalidation that retains backend identity/state. Tests consume built public exports and use real filesystem changes and loopback listeners.

These are partial DF/DT lifecycle cells, not complete host conformance. Failed-restart candidate cleanup, failed native setup, preview, bundled dev, browser-side HMR delivery, remote SDK transport, authentication and browser UI need separate evidence. No Chromium/Firefox extension cell is satisfied by these tests.

Provider routing, state, transport, real-host lifecycle and the complete API-to-example catalogue remain required. View, script and transform entries still need domain-specific implementation. Do not infer supported host cells from these local controller tests.

## Local routing implementation evidence

| Implemented API | Example and automated evidence | Proven scope |
| --- | --- | --- |
| `RoutingPolicy`, `RoutingCallback`, `RoutingContext`, `RoutingCandidate` | Core inert-callback test and compile fixtures; client callback tests | Local callbacks retain author-owned function identity, receive immutable candidate metadata and cancellation, preserve original candidate owners and recheck readiness. No callback serialization. |
| `createClient`, `ProviderConnection`, `ProviderAttachment`, `ConnectionSnapshot` | Client registry tests; server `demo:routing` | Fixed identity, duplicate rejection, attach/detach/dispose ownership, authoritative versus unknown catalogs, observer isolation. Native server handles satisfy the interface. |
| Routed action/capability invoke and capability resolve | Client routing/request-boundary tests; real two-server demo | Default precedence, ordered fallback, ambiguity, exact contract selection, no replay, binding ownership, schema-defined domain inputs and malformed-input rejection. Permissions remain adapter-owned. |
| Capability/action broadcast, `BroadcastInvocationOptions`, `BroadcastOutcome` | Core positive/negative type fixtures; client broadcast tests; real two-server counter check | Required recipient union, missing-recipient rejection before any dispatch, overlap deduplication, retained successful siblings and known-unavailable outcomes. |
| `RoutingError`, `RoutingErrorCode` | Client tests and packed consumer | Local codes and actionable unmatched-selector diagnostics; no network serialization claim. |
| Portable package exports | `scripts/check-packages.ts` | Core/runtime/client tarballs installed without workspace sources; strict Bundler and NodeNext compilation, execution and host-free browser bundling. |

These checks add local DF/DT composition evidence. Native remote synchronization evidence is recorded below. Automatic endpoint discovery and all WebExtension cells still require their domain implementations and real-host checks.

## Authenticated native server example evidence

`examples/server-contexts` exports `runRemoteDemo`; `demo:remote` and `checks/remote.ts` exercise it through built public exports on genuine Devframe hub and DevTools kit hosts. Native token authorization gates explicitly named RPC definitions that delegate to the same portable action. Assertions cover denied credentials, valid native session ownership, invalid input, action rejection after provider disposal, retained unrelated HTTP, stale-incarnation rejection, same-ID replacement with native state retention, and actual host shutdown rejecting a pending client call.

The server handler deliberately finishes after the socket closes, proving that client rejection is not backend cancellation. Four adapter-owned method names remain across replacement, alongside two example-only probes. Startup exposure and direct strict installation handles are implemented and type-checked. Native schema reuse, registration conflicts, implementation-owned applicability, inactive implementations and failed native observers have dedicated server checks. This adds real native authentication/transport evidence; it does not implement automatic remote contribution publication, automatic endpoint discovery, backend unary cancellation, or any WebExtension cell. The [lifecycle investigation](../research/native-rpc-lifecycle.md) identifies the remaining public API gaps.

## Native remote client evidence

| API or behavior | Maintained evidence | Scope |
| --- | --- | --- |
| `createDevframeProviderConnection`, `DevframeProviderConnection`, options | Server socket tests and compile probes; browser example on both native hosts | Existing native client; fixed identity; typed actions/capabilities; remote context has no raw backend handles; static/cached endpoints reject. |
| Authorized catalog synchronization | `remote-catalog.test.ts`, `remote-client.test.ts` | Exposed contracts only; no writable catalog state; immutable validated metadata; payload-free invalidation; stale-query fencing; disable/enable; replacement requires new attachment. |
| Cancellation and disposal | `remote-cancellation.test.ts` | Caller abort, client disposal, adapter disposal and native disconnect stop waiting. Backend completes once; no replay or backend-cancellation claim. |
| Browser entry and real hosts | `checks/browser-build.ts`; `demo:browser devframe` / `devtools` | Built exports, no Node/runtime modules; actual browser action and retained-state reload on both hosts. Manual smoke is distinct from automatic socket/build checks. |

Browser capability authority, automatic endpoint discovery, renderer/extension integration and full host conformance remain open. No Chromium/Firefox extension cell is satisfied by the native browser example.

## Two-layer applicability evidence, 2026-09-27

`packages/server/tests/applicability.test.ts` opens four authenticated native connections between two clients and two backends. It proves realm-selected broadcast, schema-defined resource input, per-provider `applied`/`not-applicable` results, independent state reads, the same guard on direct capability invocation, continued provider availability and one client's continued operation after the other closes. Catalogs expose no generic target metadata.

`packages/core/tests/requests.type-test.ts` verifies custom resource-reference inference, operation/input correlation and rejection of the removed top-level target option. `packages/runtime/tests/provider-requests.test.ts` verifies that payload fields named `target` and `signal` remain ordinary input. Provider incarnation, activation ownership and no replay remain covered by the existing lifecycle/routing tests.

These are command/result and explicit-read checks. Native state subscription/snapshot ordering, cross-client live updates and reconnect recovery remain requirements of issue 8; no event-delivery guarantee or browser-extension cell is implied.

## Native state observation evidence, 2026-09-27

The browser example now uses native `sharedState.get`, `state.value()` and `state.on('updated', ...)` directly. Four example tests on genuine Devframe/DevTools hosts prove peer updates, separate host values, listener removal, fresh-client snapshot recovery, retained incarnation and native client writes. Live two-tab checks confirm rendering, stale-state labels, reconnect and continued operation after peer closure on both hosts. Actual DevTools server shutdown disables actions and marks the view stale. [Detailed receipts and limits](../research/native-state-observation.md).

The owner subsequently accepted native lifetime and write policy. Contributions/hosts own keys, scope, validation, persistence, migration and conflicts; there is no generic SDK state API or mandatory enforcement layer. It does not claim automatic reconnect, atomic snapshot/subscription ordering, JSON rendering or WebExtension conformance.

The native-lifetime follow-up adds two real-host tests to `tests/state.test.ts`, six total. They verify provider disposal/replacement with retained state and existing observers, stale action binding rejection, fresh attachment and a separate fresh host starting at the initial value. The browser launcher exposes the same existing `replace` operation for manual confirmation.

## Native JSON renderer evidence, 2026-09-28

`examples/json-render` uses built public exports for the existing shared counter and both native hosts. `createJsonRenderView`, `toJsonRenderDockEntry`, `jsonRenderUiRenderer`, `createDevframeClientRuntime` and the native mount/dispose registry are composed directly. No SDK renderer facade or context cast is introduced.

Five automated tests verify native dock/manifest publication, exact renderer asset bytes, authorized action execution, denied/invalid calls, subscribed view patches, owned projection cleanup and a browser bundle free of Node/provider implementation modules. Live two-tab checks on Devframe and DevTools verify native-rendered peer updates, error banners, unmount/remount with current state and actual host-disconnect teardown. [Commands, evidence and native limitations](../../examples/json-render/README.md).

This satisfies the single-provider server rendering path only. Cross-provider selection, a custom renderer, extension Ports/surfaces, renderer-module replacement and automated real-browser coverage remain open. The native reference renderer's persistent error banner and console rejection on deliberately invalid input are recorded rather than concealed.

## Candidate native Port and renderer evidence, 2026-09-28

The [isolated extension proof](../probes/native-port/README.md) consumes built candidate Devframe public exports and confirms two actual Chromium Ports, separate caller identity across an asynchronous handler, native JSON action/state updates, native state writes, rich-value serialization and function rejection. It also confirms pending-call rejection, renderer disposal, retained worker state after reconnect without action replay, denied sender admission and cleanup when the initial view fetch fails. The recorded Chromium run reports zero page errors.

The source changes are separated into [RPC/state for #7](https://github.com/dvcolomban/devframe/commit/fe0fb623da5032b512cedf4956a215cff7a7f594) and [renderer/view for #12](https://github.com/dvcolomban/devframe/commit/5677ecd69e7b1a758233173846aead05b0654023). Existing native renderer context types keep their defaults. The native factories and reference renderer accept their actual dependencies; no local state engine, JSON dialect or fabricated native context is introduced.

This is candidate upstream integration evidence, reviewed and submitted as [Devframe draft PR #410](https://github.com/devframes/devframe/pull/410). It does not satisfy complete CH/FF provider conformance: the proof has no portable provider catalog/router binding, content/page bridge, debugger, browser toolbar popup/DevTools/side-panel lifecycle, worker suspension policy or extension HMR. Firefox remains untested. No downstream dependency patch has been applied.


## Maintained WebExtension channel, 2026-09-29

`@devkit/webext.createPortChannel({ port, onDisconnect })` returns the existing native RPC channel type. It accepts structural Chrome/Firefox Port members, uses Devframe's records serializer and removes message/disconnect listeners through native `off`. The caller owns sender admission, native `$close()` and Port lifetime. No request protocol, auth policy, retry or routing implementation is added.

| Contract | Automated evidence | Live evidence |
| --- | --- | --- |
| Native requests and rich values | `packages/webext/tests/channel.test.ts`, real MessageChannels with JSON and clone delivery | Two Chromium Ports, native renderer action, Map/BigInt and function rejection |
| Native close and listener ownership | Pending calls reject, both listener sets empty, started work completes once | UI and worker disconnect, renderer unmount, reconnect without replay |
| Browser type/bundle compatibility | Strict TS7 declarations, package build, type-aware Oxlint | Built public package imported by the extension example; zero page errors |

The [recorded example](../probes/native-port/README.md) now imports the maintained package instead of a local channel copy. It uses the split native drafts [410](https://github.com/devframes/devframe/pull/410) and [411](https://github.com/devframes/devframe/pull/411). [Snapshot repair 412](https://github.com/devframes/devframe/pull/412) is independent. The SDK baseline remains Devframe 1.0.0; the native shared-state/renderer backport and complete provider/catalog composition are still pending. Simulated clone delivery is not Firefox browser conformance.
