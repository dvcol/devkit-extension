# Contribution and realm contract: review packet

Status: explicit descriptors selected by the project owner; activation style and the full contract remain under discussion. This is preparation for [Contribution and realm contract](https://github.com/dvcol/devkit-extension/issues/5), not an accepted public API or SDK implementation. The canonical decision will live in the issue's eventual resolution comment.

## Grounding and settled constraints

[The map](https://github.com/dvcol/devkit-extension/issues/1) already fixes build-time executable contributions, framework-neutral authoring, extensible capabilities and realms, separate provider state, and native resources local to their owner. A contribution can contain UI alone, behavior alone, or both. These requirements do not need another approval round.

[Upstream reuse audit](https://github.com/dvcol/devkit-extension/issues/2#issuecomment-5778116319) establishes reusable released RPC/state/JSON contracts and layered Devframe/hub/DevTools contexts. A Vite DevTools provider may expose several native server contexts at once. It is not three competing providers solely because three library contexts are present.

[Browser capability audit](https://github.com/dvcol/devkit-extension/issues/3#issuecomment-5778483567) establishes local execution boundaries and distinct unavailable outcomes. MAIN scripts have no extension messaging, isolated scripts cannot access the debugger, and Firefox lacks the Chromium native extension debugger. An unavailable capability must not silently disable unrelated contribution behavior.

[Toolchain and reload audit](https://github.com/dvcol/devkit-extension/issues/4#issuecomment-5778484961) proves a portable TS7/Vite/Oxc pipeline. Its WXT declaration/reload gates remain owned by later contracts. This ticket does not choose a packager or equate source edits with successful runtime replacement.

The glossary records only the settled distinctions. The `Feature` grouping below is a proposal and therefore is not added to that glossary yet.

## First decision: how packages extend the API

The project owner selected explicit imported contract descriptors on 2026-09-23. A downstream package exports a descriptor carrying its stable identity/version and TypeScript operation types. Providers register implementations against it. Consumers import that same contract to obtain a typed binding. No central realm union or global TypeScript augmentation is required.

Illustrative shape only:

```ts
interface PageTitleApi {
  read(input: { target: TargetReference }): Promise<{ title: string }>;
}

export const pageTitle = defineCapability<PageTitleApi>({
  id: 'example.page-title',
  version: 1,
});

const binding = await context.capabilities.connect(pageTitle, {
  target: context.target,
});

if (binding.status !== 'available') {
  return showUnavailable(binding.reason);
}

const result = await binding.api.read({ target: context.target });
```

`TargetReference`, `defineCapability`, `connect`, and the result shape are proposed core exports. `showUnavailable` is example UI behavior, not an SDK hook. The `read` operation executes in the selected provider's eligible execution context; its consumer receives a serializable result. TypeScript operation types alone are not runtime validation. Wire validation and authorization must be specified with [Permissions and trust](https://github.com/dvcol/devkit-extension/issues/9) before implementation admission.

The alternative is declaration merging: downstream packages augment a global capability map, and consumers use typed string keys such as `context.capabilities.connect('example.page-title')`. This is convenient for a fluent context API, but type visibility then depends on installed augmentations. Both choices still need runtime registration and capability negotiation; declaration merging does not provide those by itself.

| Choice | Downstream author experience | Tradeoff |
| --- | --- | --- |
| Explicit descriptors, selected | Import the capability/realm contract being used; register implementations explicitly | More visible imports; local types and runtime declarations stay together |
| Declaration merging | Extend a shared type map; call APIs through known string keys | Convenient completion; ambient extensions can collide or appear available in compilation without a runtime registration |

Proposed identity rule: compare the declared contract identity/version at runtime, never JavaScript object identity across separately bundled copies. Reject ambiguous duplicate implementations within the same provider registration scope. Version compatibility and schema consistency still require an explicit policy after the authoring model is chosen.

## Second decision: who owns optional feature lifetimes

The owner leans toward host-managed activation and requires definition modules separate from core runtime. The [revised definition/runtime proposal](./005-plugin-definition-runtime.md) recommends plugin for the installable unit and contribution for what it adds. It removes the generic feature/handler grouping and `whenAvailableAgain`, and distinguishes binding loss from operation unavailability. The older sketch below is comparison context, not an accepted contract.

Recommend independently managed features within a contribution. A feature is the smallest group of registrations with shared execution requirements and a shared cleanup lifetime. A simple contribution has one feature. A mixed contribution can have a view feature and a debugger feature.

The host activates a feature only when its required capabilities and execution context are available. Failure or loss of a required capability ends that feature's registrations. Other independently eligible features remain active. A JSON view can still explain why its debugger controls are unavailable.

Illustrative build-time declaration, not a finalized manifest:

```ts
export const inspectionContribution = defineContribution({
  id: 'example.inspection',
  features: [
    {
      id: 'title-view',
      entry: './title-view.ts',
      execution: presentationContext,
      requires: [jsonViews, actions, providerState],
    },
    {
      id: 'debugger-tools',
      entry: './debugger-tools.ts',
      execution: providerContext,
      requires: [debuggerCommands],
    },
  ],
});
```

The entry locations are resolved at build time and contain packaged executable code. `presentationContext` and `providerContext` describe roles satisfied by eligible host executions; they do not magically move a callback to another process. The adapter maps roles to concrete entry bundles. The debugger implementation can live in Chromium background code or an eligible server provider; the presentation consumes its transported operations. No debugger declaration makes Firefox's missing native API available.

The alternative is one setup function per contribution execution. Authors check optional capabilities, register available pieces and manage their availability subscriptions and cleanup themselves. This has fewer manifest concepts but puts partial-failure and reconnection rules in every contribution author's code.

| Situation | Independently managed features, recommended | One setup function |
| --- | --- | --- |
| Firefox has no debugger implementation | Debugger feature unavailable; independent view/actions still active | Author branches correctly and keeps unaffected registrations alive |
| Permission disappears while a feature is active | Host ends the affected activation and its owned registrations | Author watches availability and removes affected registrations |
| Setup throws after registering an action | Host unwinds that feature's scope | Contribution setup must use the host scope correctly; partial grouping is authored manually |
| Simple UI-free contribution | One feature, no renderer required | One setup function, no renderer required |

This recommendation does not settle automatic retry or reactivation when capability availability returns. Those choices depend on the activation unit and are the next lifecycle questions, together with async teardown and dependency failure propagation.

## Shared and native examples for the discussion

### Shared title inspector

One contribution describes a JSON title view and a read-title action. Devframe, Vite DevTools and WebExtension providers implement the title capability. The common view invokes the same typed operation; it never imports Node, Chrome or Firefox APIs.

Two provider instances may return different titles and retain different state. A provider binding records its provider identity and target generation. Selection, broadcast and per-provider outcomes use the integration point owned by [Provider discovery and routing](https://github.com/dvcol/devkit-extension/issues/7). Persistence and synchronization use the integration point owned by [State scope and recovery](https://github.com/dvcol/devkit-extension/issues/8). This sketch chooses neither policy.

### Native background integration

Only an eligible local background entry may access the native extension event below. Acquiring a realm descriptor alone does not prove background access.

```ts
export function activate(context: FeatureContext): void {
  const native = context.native.find(webExtensionBackground);
  if (!native) return;

  const installedEvent = native.browser.runtime.onInstalled;
  const onInstalled = (): void => {
    console.info('Example extension installed');
  };

  installedEvent.addListener(onInstalled);
  context.scope.onDispose(() => {
    installedEvent.removeListener(onInstalled);
  });
}
```

`FeatureContext`, `native.find`, the `webExtensionBackground` descriptor and `scope.onDispose` are proposed core/adapter APIs. This example logs an installation event locally. The callback and native event stay in the background execution. If the single-setup alternative is chosen, the corresponding context/scope belongs to that contribution execution instead.

A server-native equivalent can expose Devframe, hub, DevTools kit and Vite resources together, where actually present. A downstream realm provides its own local descriptor and native type without modifying the core.

### Transform-only and page-only contributions

A transform-only feature registers an HTTP transform and cleanup with the eligible provider. It has no view and requires the corresponding transform capability. Chromium debugger Fetch and Firefox filtering satisfy different implementations with explicitly declared semantic limits. CDB integration remains conditional on its managed Fetch configuration gate.

A page-only feature runs a packaged entry against a specific document generation. It can access page-owned resources and the validated page bridge but receives no background native namespace. Document replacement ends its activation. Parser timing, CSP and frame coverage remain owned by [Injection and transform contract](https://github.com/dvcol/devkit-extension/issues/11).

## Context exposed by every capability binding

Propose a context with separate provider, realm, execution, target and presentation descriptors. It also discriminates local implementation access from transported access.

| Binding | Context information | Native access |
| --- | --- | --- |
| Local implementation | Provider identity/realm, actual execution, target generation, optional UI placement | Typed resources owned by that execution, narrowed through an imported native-context descriptor |
| Remote consumer | Serializable provider/execution/target descriptors and operation availability | No remote native resource property; use transported operations |
| Presentation | Its own local execution and UI surface; selected provider bindings remain separate | Only native resources of the presentation document itself |

A provider realm such as `webext` never grants background APIs to its MAIN or content entries. A remote provider describing itself as `webext` never gives the caller a local browser namespace. Third-party realm registration extends typed access without requiring a central exhaustive union.

Unavailable semantics already resolved by research remain distinct: unsupported implementation, wrong execution context, missing permission, restricted target, disconnected backend, conflicting owner and stale target. Snapshot availability can change before an operation executes, so invocation failures must carry the same distinctions. Public names and data shapes are still candidate contract decisions.

## Proposed ownership and failure table

| Event | Owner and intended consequence | Still to settle |
| --- | --- | --- |
| Host begins activation | New scope for the chosen activation unit; register only after requirements are checked | Feature grouping versus one setup |
| Registration succeeds | Scope owns its unregister callback; optional explicit disposal removes it once | Exact registration/disposable API |
| Setup fails partway | Scope unwinds resources already registered | Failure propagation to dependent features/contributions |
| Popup or panel closes | Presentation scope ends; independent provider work continues | Native UI lifecycle proof in the renderer contract |
| Target document is replaced | Old document registrations end; stale operations cannot affect the replacement | Cancellation and retry policy in target/routing/state contracts |
| Required capability becomes unavailable | Affected activation stops owning privileged operations | Automatic reactivation versus explicit restart |
| Worker terminates abruptly | No guarantee that JavaScript cleanup runs; next activation reconciles durable ownership/state | Recovery protocol in the state contract |
| Contribution code is replaced | Dispose the old generation where possible; identify a fresh activation | Cleanup deadline, overlap and last-good behavior in the reload contract |

The host must reject cycles and missing required contribution dependencies before activation. Duplicate contribution identity must produce an explicit diagnostic, not a last-registration-wins overwrite. These are proposed defaults for the final resolution, not completed runtime behavior.

## Candidate public inventory and acceptance obligations

This is the complete candidate inventory for this ticket's contribution/context/lifecycle layer. Action, state, routing, rendering and transform protocols remain owned by their linked decisions. Exact signatures depend on the two choices above.

| Candidate API/type/hook | Example obligation | Required assertions |
| --- | --- | --- |
| `defineContribution`, contribution identity and entry/dependency declarations | Shared inspector, UI-free transform and page-only contribution | Build-time entry discovery, duplicate/cycle/missing dependency diagnostics, no renderer requirement |
| `defineCapability`, contract identity/version and operation types | Downstream page-title contract | Third-party registration, incompatible versions, duplicate bundled descriptors, actual runtime availability |
| Realm/native-context descriptor registration | Downstream test realm and WebExtension/Devframe adapters | No core union edit, correct typed local narrowing, no native resources in transport payloads |
| Provider/execution/target/presentation descriptors | Same contribution under two provider instances | Distinct identity/state, correct execution, replaced-target rejection |
| Capability `describe`, `watch`, `connect` and invocation binding context | Shared inspector plus optional debugger | All unavailable distinctions; availability race during call; watch disposal; remaining features stay usable |
| Activation hook and activation outcome | Shared, transform-only, page-only and native features | Successful activation, partial setup failure, required capability loss, no duplicate active registration |
| Scope registration, `onDispose`, cancellation signal and disposable registration | Native event listener and action/state subscriptions | Exactly-once explicit cleanup, late completion behavior, abrupt termination without assuming cleanup ran |
| Host registration/activation/disposal entrypoints | Each host example through public packages | Real host execution, independent presentation/provider lifetimes, packaging boundaries |

Each applicable row must execute on standalone Devframe, Vite DevTools, Chromium and Firefox, using public package exports. Add a downstream realm example and a replaceable renderer example. Unsupported combinations must assert unavailability while unrelated functionality continues. Mocks, type checks and parser validation alone cannot satisfy real-host claims.

These are obligations for [Examples and API coverage contract](https://github.com/dvcol/devkit-extension/issues/14), not claims that those examples exist. Its independent inventory/registry checker must reject missing links or unsupported cells mislabeled as supported.

## Decision status

Explicit imported capability/realm descriptors are selected. Global declaration merging is not the primary extension mechanism. This selection does not approve descriptor signatures or version negotiation policy.

Activation remains open. The owner requested [concrete sketches of both styles](./005-activation-comparison.md) before choosing host-managed features or one author-managed setup function.

After that answer, settle concrete signatures, version compatibility, dependency failure propagation, async disposal and reactivation rules. Final user review still precedes closing the contract. No dependent contract is silently resolved by this packet.
