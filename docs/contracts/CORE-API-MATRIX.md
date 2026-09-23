# Core API proof matrix

Required implementation evidence for [ARCHITECTURE.md](../../ARCHITECTURE.md) and [core declarations](./core.d.ts). Example/test names are planned obligations, not claims that those applications or runtime tests exist today.

Host codes: **DF** standalone Devframe, **DT** Vite DevTools, **CH** Chromium extension, **FF** Firefox extension. Each runtime row applies to all four unless it names a native restriction. The renderer-independent example also runs with the renderer absent. Target-bearing rows run against real target/document generations.

| Public exports or hooks | Example/fixture | Required assertions |
| --- | --- | --- |
| `defineRealm`, `RealmDescriptor`; `defineExecution`, `ExecutionDescriptor`; `ProviderDescriptor`, `ContextMetadata` | `examples/custom-realm`; `contracts/context-types` | New realm/execution IDs preserve literal types; no core switch/renderer change; provider identity remains separate |
| `defineNativeContext`, `NativeContextDescriptor`, `NativeContextAccess.get`, `BindingContext` | `examples/native-context`; `contracts/context-types` | Correct local type or absent; remote `native` access fails compile; native objects never cross messages; unavailable APIs return absent on unsupported hosts |
| `defineOperation`, `OperationDefinition`, `OperationInput`, `OperationValue`, `TargetRequirement` | `examples/contribution`; `contracts/schema-inference` | Mandatory input/return validators and target mode; original-value inference including transforming schemas; reject invalid runtime input/return |
| `defineCapability`, `CapabilityDescriptor`, `CapabilityImplementation` | `examples/multi-version-service`; `contracts/implementation-types` | Mandatory numeric version and schemas; missing/wrong method types fail compile; exact versions coexist; changed schema under same version is invalid |
| `CapabilityApi`, `OperationArguments`, `OperationContext`, `InvocationOptions`, `RoutedInvocationOptions`, `TargetReference` | `examples/targeted-action`; `contracts/target-types` | Required target enforced; targetless call rejects target; target separate from payload; stale generation rejected; raw promise values preserved |
| `CapabilityClient.resolve`, `CapabilityResolution`, `CapabilityBinding`, `AvailabilityReason` | `examples/routing`; `runtime/availability` | Correct provider/context; each availability cause; binding provider does not silently change; call-time races still fail explicitly |
| `CapabilityClient.invoke`, `ActionClient.invoke`, `RoutingDirective` boundary | `examples/routing`; `runtime/call-routing` | Select before dispatch; exact pin/default precedence; no rerouting after timeout/disconnect; ordinary errors reject; broadcast obligations finalized in routing ticket |
| `defineService`, `ServiceDeclaration`, `ServiceDefinition`, `SetupContext`, `CapabilityRequirements`, `RequirementBindings` | `examples/contribution`; `runtime/service-installation` | Same startup/runtime recipe; exact requirement inference; undeclared services fail compile; native setup location correct; no renderer needed |
| `defineAction`, `ActionDescriptor`; `defineActionContribution`, `ActionDeclaration`, `ActionDefinition` | `examples/contribution`; `contracts/action-types` | Public descriptor imports no handler; handler signatures inferred; required capabilities share selected provider; explicit orchestration only |
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
- `runtime/two-providers`: simultaneous providers/versions remain separately owned; state and native contexts never merge.
- `hosts/lifecycle`: real worker restart, panel closure, navigation, reconnect and permission transitions exercise their supported operations and explicit unsupported states.
- `hosts/modes`: development and built-asset live preview/release paths receive separate assertions; source HMR is not proof of preview behavior.
- `examples/custom-renderer`: replace the renderer through public interfaces and repeat action/state/error behavior without modifying contributions.
- `contracts/negative`: exact missing/wrong implementations, version-less definitions, missing targets, undeclared dependencies, incorrect custom-kind payloads, unknown plugin properties and remote-native access are compiler errors.

View, script, transform, state, debugger and native adapter-specific helpers/hooks receive additional rows from their domain tickets before implementation admission. The matrix cannot count a declaration-only type check or browser mock as a successful real-host runtime cell.
