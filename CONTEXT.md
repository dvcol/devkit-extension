# Portable contribution ecosystem

The shared language for contributions used through development-server and browser-extension hosts.

## Language

**Contribution**:
An addition supplied by a plugin, such as an action, view, transform, script or service. Contributions share ownership terminology while retaining the behavior of their particular kind.
_Avoid_: Whole plugin, mandatory mixed collection

**Plugin**:
A named collection of contributions installed and controlled together. A plugin may supply behavior, presentation, services, or a combination.
_Avoid_: Browser extension, provider instance

**Host**:
The application composing providers, clients and their integrations. A host can use several providers across different realms at the same time.
_Avoid_: Single backend, realm

**Service definition**:
A recipe for constructing an implementation of a capability. The same definition can be installed during startup or while its provider is running.
_Avoid_: Capability contract, already-running service

**Provider**:
An identifiable instance offering capabilities to contributions. Two providers can offer the same capability while retaining different state and targets.
_Avoid_: Realm, UI surface

**Realm**:
The declared environment family of a provider, such as a browser extension or a development server. Realm identity is distinct from the host integration and the particular place where code executes.
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
The explicit contract for a capability, identifying its version and operation schemas independently of a provider implementation or its current availability.
_Avoid_: Implementation, capability instance

**Contract version**:
A numeric revision of a capability contract, distinct from the release version of a package containing it.
_Avoid_: Package version, inferred compatibility range

**Target**:
The subject of an operation, such as a particular inspected tab or document. A replacement document is a different target generation even when the tab remains the same.
_Avoid_: Provider, UI surface

**Native context**:
The environment-specific resources available in the execution context that owns them. A remote description of that context does not contain those resources.
_Avoid_: Remote native handle

**Routing policy**:
Rules for selecting provider instances for an operation using its target, caller input and declared preferences. Routing a call is distinct from constructing a service implementation.
_Avoid_: Implementation installation, provider-state synchronization
