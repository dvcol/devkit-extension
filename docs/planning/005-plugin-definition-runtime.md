# Plugin definitions, contributions and host runtime

Proposal for [Contribution and realm contract](https://github.com/dvcol/devkit-extension/issues/5). The owner selected explicit imported descriptors and requires definition modules to stay separate from the core runtime. Host-managed lifecycle is their preference, pending a concrete contract. The names and signatures below remain proposed.

## Separate the things we are naming

The earlier `defineContribution` sketch described an entire installable tool, its entry modules and its activation. Calling all of that a contribution obscures what the tool adds to its host. Recommend the following vocabulary:

| Term | Responsibility | Example |
| --- | --- | --- |
| Plugin definition | Identifies a reusable, installable tool and its packaged entries | A page inspector |
| Contribution definition | Describes something the plugin adds to the host | An action, JSON view, state declaration or HTTP transform |
| Capability descriptor | Identifies a typed service contract that a provider can implement | Read a page title, perform debugger operations |
| Capability implementation | Supplies that contract in an eligible execution context | A browser-backed page service |
| Host | Composes plugins, capability implementations and contribution registries | WebExtension or Devframe host |
| Plugin handle | Observes and controls one live plugin installation | Enable, disable, inspect status and dispose |

A plugin can contribute behavior alone, UI alone, or both. A package may export several plugins or contribution definitions. A plugin is not necessarily an npm package or a separate browser extension. The browser extension itself can host many plugins.

Reserve **handler** for an actual callback, such as an action handler. Remove the earlier generic `features`/`handlers` layer. A contribution can have dependencies and an owned registration lifetime without every author inventing another feature grouping.

`Integration` is a reasonable alternative for the installable unit, especially in host documentation, but it is also used for host adapters and external connections. `Module` clashes with JavaScript entry modules. `Capability` is already needed for the common service contract. Recommend `Plugin` for the installable unit and `Contribution` for what it adds.

The existing glossary still records the earlier whole-feature meaning of contribution. This packet explicitly proposes revising that meaning; it does not silently treat the rename as accepted.

## Architectural basis

The inspected public Devframe definition helper returns a typed definition. Host installation separately resolves assets, queues services and invokes setup. Vite DevTools adds a host adapter around that definition. These are the useful boundaries to retain:

- [Devframe definition helper](https://github.com/devframes/devframe/blob/a3f967755af99a0a0d8dd82b7b5d4f3dd4aec0bc/packages/devframe/src/define.ts).
- [Devframe definition contract](https://github.com/devframes/devframe/blob/a3f967755af99a0a0d8dd82b7b5d4f3dd4aec0bc/packages/devframe/src/types/devframe.ts).
- [Hub installation](https://github.com/devframes/devframe/blob/a3f967755af99a0a0d8dd82b7b5d4f3dd4aec0bc/packages/hub/src/node/install-devframe.ts).
- [Vite DevTools adapter](https://github.com/vitejs/devtools/blob/121656dfc5866b2f8de5baa8e0b6166ec28599c8/packages/kit/src/node/create-plugin-from-devframe.ts).

These links identify the inspected checkout revisions, not a new claim about the latest released API. Release reuse constraints remain in [Upstream reuse audit](https://github.com/dvcol/devkit-extension/issues/2#issuecomment-5778116319).

The owner also asked us to follow the composition pattern of their existing tooling. The generic lesson is that feature authors supply typed definitions or contribution results, and a separate composition root installs them, projects their metadata and owns disposal. This proposal carries that pattern forward without importing downstream application code or domain contracts. Some existing definition factories already allocate resources, so inert definition helpers are a deliberate strengthening of that boundary. Complete unloading is also a new obligation; existing subscription cleanup alone does not prove that actions, views and every native registration can be removed.

## Package and import boundaries

Illustrative package names, not a naming decision:

| Package or module | Contains | Allowed dependencies |
| --- | --- | --- |
| `definitions` | Plugin, capability, execution and native-context descriptors; common context and lifecycle types | Portable types and small definition helpers |
| Capability contracts | Typed operations, schemas and explicit descriptors | Definitions and portable schema dependencies |
| Contribution definitions | Action, JSON view, transform and other typed declarations | Definitions and relevant capability contracts |
| `runtime` | Installation, binding resolution, registries, ownership, cancellation and status | Definitions and portable runtime utilities |
| Host adapters | Native implementations, entry loading and transports | Runtime, contracts and eligible platform libraries |
| Renderer implementation | Maps a JSON view and actions to an actual UI | View contracts and the renderer's chosen UI implementation |
| Example plugins | Feature definitions and packaged entry code | Definition/contract modules; local native modules only in eligible entries |

A definition helper constructs a typed descriptor. Importing it does not start a host, open a connection, install a listener or import the core runtime. Executable callbacks are packaged code; a definition containing callbacks is not a JSON wire payload. Only serializable metadata and validated operation arguments/results cross contexts.

Keeping definitions and runtime separate is a dependency boundary. A `setup` function can be declared in a definition and invoked later by the runtime without the definition package depending on that runtime.

## Concrete authoring sketch

### Define a capability contract

```ts
// contracts/page.ts
import { defineCapability } from '@portable-sdk/definitions';

export interface PageApi {
  readTitle(
    input: { target: TargetReference },
    options: { signal: AbortSignal },
  ): Promise<{ title: string }>;
}

export const pageCapability = defineCapability<PageApi>({
  id: 'example.page',
  version: 1,
});
```

`TargetReference` is a common contract type. Real operation declarations also require runtime schemas and the agreed unavailable-outcome shape. TypeScript types alone cannot validate a message. This example isolates the capability identity from any implementation; it does not settle its wire schema.

### Define what the plugin contributes

```ts
// contributions/read-title.ts
import { defineAction } from '@portable-sdk/actions/definitions';
import { pageCapability } from '../contracts/page.js';
import { readTitleInput, readTitleOutput } from './schemas.js';

export const readTitleAction = defineAction({
  id: 'example.inspector.read-title',
  input: readTitleInput,
  output: readTitleOutput,
  requires: { page: pageCapability },

  handler({ input, services, signal }) {
    return services.page.api.readTitle(input, { signal });
  },
});
```

`readTitleInput` and `readTitleOutput` are imported portable runtime schemas. `requires` maps local names to explicit capability descriptors. It supplies the typed `services` keys to this action's callback. It does not request browser permission, select a provider or target, attach a debugger or invoke the action.

A separate JSON view definition can reference this action's identity and bind its input/result using the renderer contract. It does not import the action implementation's platform backend. The renderer catalog and exact view schema remain in [Renderer and surface contract](https://github.com/dvcol/devkit-extension/issues/12).

```ts
// provider.ts
import { definePluginEntry } from '@portable-sdk/definitions';
import { readTitleAction } from './contributions/read-title.js';
import { inspectorView } from './contributions/inspector-view.js';

export default definePluginEntry({
  setup() {
    return [readTitleAction, inspectorView];
  },
});
```

The entry returns contribution definitions. The host validates and installs them in their respective registries. An action callback runs when invoked; returning its definition does not execute it. A view contribution publishes the JSON view; rendering belongs to a UI execution with its own lifetime.

For context-dependent definitions, `setup(context)` receives the entry's local execution context and resource scope. It can construct contributions from configuration and register cleanup for resources it owns. Returning static definitions is the simplest case. A static `contributions` shorthand can be added later if it reduces real repetition; it is not necessary to establish this contract.

### Package the entries as one plugin

```ts
// plugin.ts
import { definePlugin, providerExecution } from '@portable-sdk/definitions';

export const inspectorPlugin = definePlugin({
  id: 'example.inspector',
  entries: {
    provider: {
      execution: providerExecution,
      module: './provider.ts',
    },
  },
});
```

The build integration resolves the entry relative to its defining module and packages it for eligible hosts. The WebExtension adapter maps this role to background execution; a server adapter maps it to its provider process. Content, page and presentation executions use separate declared entry modules where needed. Executable entry discovery, module resolution and host-role compatibility must be checked by the packaging contract. Runtime installation only uses packaged entries.

### Install through the runtime

```ts
// extension host composition
import { createWebExtensionHost } from '@portable-sdk/host-webext';
import { inspectorPlugin } from './plugin.js';
import { pageCapability } from './contracts/page.js';
import { pageImplementation } from './adapters/page.webext.js';

const host = createWebExtensionHost({
  providerId: 'example.extension',
});

host.provide(pageCapability, pageImplementation);
const installation = await host.install(inspectorPlugin);
```

```ts
// development-server host composition
import { createDevframeHost } from '@portable-sdk/host-devframe';
import { inspectorPlugin } from './plugin.js';
import { pageCapability } from './contracts/page.js';
import { pageImplementation } from './adapters/page.devframe.js';

const host = createDevframeHost({
  providerId: 'example.development-server',
  devframe: devframeContext,
});

host.provide(pageCapability, pageImplementation);
const installation = await host.install(inspectorPlugin);
```

Factories install their supported standard services and contribution registries. The custom `example.page` contract still needs the explicit implementation registration shown in each composition root. The two imported implementations illustrate the adapter boundary; their platform operations are not implemented by this planning packet. A composition root can retain that registration for explicit disposal:

```ts
const implementationRegistration = host.provide(
  pageCapability,
  pageImplementation,
);
```

`pageImplementation` contains the API and its eligible local context. It is implemented in the adapter, separately from `pageCapability`. Registration returns a disposable owned by the host. Removing or replacing it invalidates existing bindings. Missing implementations are represented explicitly; no adapter provides a fake successful implementation for an unsupported browser API.

`install` validates/adopts the definition and returns a handle even if some contributions are unavailable. Invalid manifests or duplicate plugin identities reject installation. Contribution setup failures and missing implementations appear as diagnostics in the handle. Exact dependency/version rules still require review.

## What host-managed means

It means the runtime manages the contributions returned by an entry. The author defines the action/view/transform once and supplies any executable callback. The host owns validation, capability binding, registration, cancellation and teardown.

Use two distinct layers of status:

1. The host retains the declared contribution's identity and metadata while its plugin is enabled. A UI can therefore explain an unavailable action.
2. The host makes executable registrations eligible when their required bindings are valid. A required binding loss cancels affected work and removes any active registration that relies on it. Restoring bindings recreates that registration, never a completed user operation.

For an action, execution only happens on invocation. For a transform, its active interception registration can exist between requests. These contribution kinds share dependency and ownership rules, while their registries implement the actual registration mechanics.

| Event | Proposed consequence |
| --- | --- |
| No implementation exists for an action's required capability | Action metadata remains known, action unavailable, independent view remains usable |
| A required implementation is removed/replaced | Cancel affected invocations and dispose affected active registrations; retain declaration/status |
| Compatible implementation returns | Recreate eligible registrations; never replay a prior action invocation |
| Service rejects an operation for a permission, target or owner conflict | Return its specific outcome; do not automatically tear down unrelated provider work |
| User invokes an action again | Resolve/check the current eligible binding and validate the target generation at execution time |
| Plugin entry setup fails | Unwind its owned resources; expose failure; explicit retry controls setup retry |
| Plugin disabled or disposed | End its owned activations and registrations; disposal is terminal |
| Worker dies abruptly | Cleanup callbacks may not run; recovery reconciles durable ownership under the recovery contract |

Remove `whenAvailableAgain`. Restoration is a documented runtime lifecycle rule, while a failed setup requires explicit retry. Ordinary service restoration does not rerun the plugin entry's setup just to restore an action. A fresh execution or code generation does run its entry setup again.

Setup establishes definitions and reversible owned resources. Side-effecting user commands belong in action callbacks. Completed external effects cannot be undone by disposal. Target permission loss can invalidate a target-scoped binding when that binding itself depends on the permission, but it does not automatically destroy a provider-wide service or plugin.

## Context and runtime controls

Every required service binding exposes `.api` and `.context`. The binding context identifies provider, realm, owning execution, optional target generation and whether access is local or transported. The callback also has its own execution context. Those contexts can differ.

An entry setup context contains local provider/execution identity, target only for target-scoped execution, and a scope with `signal`, `use(disposable)` and `onDispose(cleanup)`. `native.get(importedDescriptor)` returns typed native resources only when that local context owns them. A server context can expose Devframe, hub and Vite descriptors together; a WebExtension context exposes only its actual browser execution's primitives. Native objects and functions never cross RPC.

```ts
interface PluginHandle {
  readonly id: string;
  readonly providerId: string;

  snapshot(): PluginSnapshot;
  subscribe(listener: (snapshot: PluginSnapshot) => void): Disposable;
  setEnabled(enabled: boolean): Promise<void>;
  retry(entryId: string): Promise<void>;
  dispose(): Promise<void>;
}
```

```ts
const observation = installation.subscribe(renderPluginStatus);
await installation.setEnabled(false);
await installation.setEnabled(true);
await installation.retry('provider');
observation.dispose();
await installation.dispose();
```

The handle is a local control object. Remote clients receive serializable snapshots and transported control operations. Snapshots contain entry lifecycle status and separate per-contribution availability, identity, generation and diagnostics. Subscription must deliver current state and changes without a read/subscribe race.

`retry` retries failed entry setup. Enabling alone does not clear failure into a retry loop. It never retries a user action. Async teardown ordering, transition completion deadlines, snapshot wire types and failure isolation for a malformed returned contribution remain open contract details.

## Extensibility and core API inventory

The contribution result must be extensible through imported descriptors just like capability contracts. Built-in helpers such as `defineAction` and the JSON view helpers produce definitions tagged with their contribution-type descriptor. The runtime dispatches them through registered contribution-type implementations. Adding a downstream kind must not require editing a central TypeScript union, a global augmentation or the core runtime's switch statement.

A contribution-type implementation owns validation and installation for that kind and returns scoped cleanup. Runtime registration of those implementations belongs in host composition. The public authoring API never imports that registry. The exact descriptor/installer generic signatures need review before claiming a complete public contract.

The proposed core inventory is:

- Definition contracts and helpers for plugins, entries, capability descriptors, contribution types, execution roles and local native-context descriptors.
- Separately exported typed contribution definitions for actions, JSON views and other supported kinds.
- Host `provide`, contribution-type registration, `install` and `dispose` operations.
- Typed capability binding and local/remote context contracts.
- Entry setup context and resource scope.
- Plugin handle, entry/contribution snapshots, enable/disable, explicit setup retry and disposal.

The full action/state/renderer/transform/debugger operation contracts are still owned by their dedicated map tickets. This sketch makes the core authoring/runtime boundary concrete without presenting those operation schemas as already resolved.

## Acceptance obligations for the final contract

These are required evidence for later implementation, not claims that this proposal already runs:

- Import a plugin/capability/contribution definition without importing runtime, native platform libraries or a UI framework. Enforce the dependency boundary from emitted bundles and declarations.
- Use the same plugin definitions through standalone Devframe, Vite DevTools, Chromium and Firefox host examples.
- Add a downstream capability and contribution kind entirely through public imported descriptors and runtime registration.
- Prove UI-only, behavior-only, mixed and target-scoped entries, including raw local context narrowing and serialization rejection of native resources.
- Keep a view and action metadata available while the action's implementation is absent. Restore the registration without invoking the action.
- Exercise binding replacement, permission/target races, cancellation, partial setup/installation failure, explicit retry, disable, disposal and execution replacement.
- Tie every public API and hook to the required example/test/host matrix under [Examples and API coverage contract](https://github.com/dvcol/devkit-extension/issues/14).

## Decision frontier

Definition/runtime separation and explicit imported descriptors are requirements. The next owner decision is the naming and composition model: **plugin** for the installable unit, **contribution** for each thing it adds, **capability** for each service contract it consumes or provides. The revised host-managed model operates on these contributions, without a generic feature/handler grouping.

If accepted, update the glossary and settle exact contribution-type registration, dependency binding, setup failure and disposal signatures. Keep this decision ticket open until its full definition of done is satisfied.
