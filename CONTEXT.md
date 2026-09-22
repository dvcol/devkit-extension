# Portable contribution ecosystem

The shared language for contributions used through development-server and browser-extension hosts.

## Language

**Contribution**:
A reusable feature definition that may contain a view, behavior, state, transforms, native integration, or a combination. A contribution can be useful without a view.
_Avoid_: Panel, plugin instance

**Provider**:
An identifiable instance offering capabilities to contributions. Two providers can offer the same capability while retaining different state and targets.
_Avoid_: Realm, UI surface

**Realm**:
The declared environment family of a provider. A realm is distinct from a provider instance and from the particular place where its code executes.
_Avoid_: Execution context

**Execution context**:
The particular process, worker, or document in which contribution behavior runs and native resources belong.
_Avoid_: Provider, UI surface

**UI surface**:
The place where a contribution view appears, such as a popup, options document, panel, sidebar, or server-hosted interface.
_Avoid_: Realm, contribution

**Capability**:
An operation or related set of operations offered by a provider, with an explicit availability outcome for the relevant context and target.
_Avoid_: Browser property existence

**Capability descriptor**:
The explicit contract for a capability, distinct from a provider implementation or its current availability.
_Avoid_: Implementation, capability instance

**Target**:
The subject of an operation, such as a particular inspected tab or document. A replacement document is a different target generation even when the tab remains the same.
_Avoid_: Provider, UI surface

**Native context**:
The environment-specific resources available in the execution context that owns them. A remote description of that context does not contain those resources.
_Avoid_: Remote native handle
