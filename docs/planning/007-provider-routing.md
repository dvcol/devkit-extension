# Provider identity, discovery and routing contract

Working deliverable for [issue 7](https://github.com/dvcol/devkit-extension/issues/7). The owner confirmed identity and discovery ownership on 2026-09-23, then ambiguity, dispatch-time availability, separate broadcast methods and a compact invocation API on 2026-09-24. The owner accepted defaults on the public action declaration. Combined realm/provider selectors, symbol handling and helper ergonomics remain under review. The [research report](../research/provider-routing.md) and its real two-hub evidence establish native integration constraints; they do not implement the complete router.

## Accepted ownership

- The embedding host configures a stable logical provider ID.
- Each backend lifetime has a fresh opaque incarnation. A transport reconnect to the same live backend retains it. UI HMR does not change it unless the backend itself is recreated.
- Existing bindings and dispatched work retain their original provider ownership. Logical ID equality does not let a successor receive old work.
- The client application's composition root owns the discovery registry. It composes supported native connection adapters and supplies provider information to UI and non-UI consumers.
- Shared extension discovery may run in the background runtime, with snapshots carried to popup/panel contexts through native ports. Native context restrictions still apply. No cross-origin singleton or mandatory new daemon is implied.
- Discovery and provider-state synchronization are separate. An endpoint's claimed identity is not authentication.
- Normal development reload follows Vite and native host lifecycle. The registry observes provider availability; it does not supervise host processes or silently replay calls.

The provider descriptor extends the already reviewed core with a mandatory `incarnation: string`. Adapters mint it; declarations do not. A stable provider ID must be configured for the intended logical owner, rather than regenerated on every client connection.

This metadata is implemented in core and the local runtime. Runtime admission rejects missing, empty and whitespace-only incarnations and freezes an identity snapshot before setup or asynchronous call validation. Eight focused ownership tests include two live providers sharing a logical ID: an old binding retains its original backend and rejects after disposal instead of switching to its successor. Contribution reactivation retains the incarnation. The complete affected core/runtime suites and packed-consumer gates also pass. This establishes local ownership behavior; remote discovery and selection remain unimplemented.

```ts
// Illustrative metadata; these are not credentials or native transport handles.
const beforeRestart = {
  id: 'example:project-server',
  incarnation: 'backend-lifetime-a',
  realm: { id: 'devserver' },
};
const afterRestart = {
  id: 'example:project-server',
  incarnation: 'backend-lifetime-b',
  realm: { id: 'devserver' },
};
```

| Event | Provider ID | Incarnation | Existing bound API |
| --- | --- | --- | --- |
| Browser renderer HMR | Retained | Retained if backend survives | Keeps the same backend ownership |
| Transport reconnect to live backend | Retained | Retained | Must not acquire another backend while reconnecting |
| Backend disposal and recreation | Retained | Fresh | Remains stale; a new resolution is required |
| Target navigation | Retained if provider survives | Retained if backend survives | Target generation is validated separately |

## Accepted routing behavior

The earlier Q6/Q8 core decisions already established that a per-call policy replaces lower-priority defaults, an exact provider pin inherits no fallback, and a dispatched call never reroutes or automatically replays. The previous version of this note incorrectly listed parts of those decisions as unresolved. The 2026-09-24 review adds:

| Decision | Accepted behavior |
| --- | --- |
| Equal candidates | Return an ambiguity error with enough permitted candidate information to request a discriminant. The UI, agent or caller must explicitly choose before making a new invocation. Do not choose by discovery order or silently skip an ambiguous preferred group. |
| Readiness | Ordinary invocations consider current readiness at dispatch; they do not queue while waiting for a connecting provider. Before dispatch, only the current policy's explicitly permitted alternatives may be considered. |
| Execution failure | A provider dropping during execution is an error. The client may explicitly request a new invocation; the router never replays the failed call. A failed response is not proof that a mutation did not execute. |
| Broadcast | Separate capability/action broadcast methods return per-provider outcomes. Ordinary invocation still returns `Promise<Value>`; an individual broadcast failure retains successful sibling results. |
| Invocation arguments | Prefer a single request object, or at most two or three clear arguments separating business input from common options. Replace the positional contract/operation/input/options chain in the final routed API. Exact signatures remain to be reviewed. |

These are contract decisions, not claims that a multi-provider router has been implemented. The current core client interfaces still use their earlier positional signatures and expose no broadcast methods.

## Current declaration review

The owner proposed putting `routing` directly on contributions. Its value could select a realm, select a provider, supply an ordered list of alternatives, or run a context-aware selector callback. Separate `realm` and `provider` properties were also suggested. This is a counterproposal to the earlier recommendation for separate client policy declarations, not acceptance of that recommendation.

The next sketch must establish how realm and provider identities are distinguished, how defaults are available to the client before backend selection, and how callback inputs and results preserve target/provider generations. Bare strings cannot be interpreted by guessing which registry namespace currently matches. Current strict service/action/plugin declarations reject an added `routing` property; a settled API requires an explicit declaration and validation change.

Trust filtering, target mapping and state restoration remain owned by their linked issues. Request-object signatures, callback cancellation, registry collisions and broadcast ordering/empty-selection behavior need concrete examples before completing this contract.

## Implementation and verification obligations

| Piece | Required evidence |
| --- | --- |
| Provider incarnation metadata | Strict declaration checks and real local calls preserve a snapshot; same-ID successors cannot reuse old bindings |
| Client-composed registry | Owned adapter attachment/detachment, authoritative versus unknown catalog, explicit provider collisions and stale incarnation updates |
| Selection | Default, exact provider, realm order, callback, ambiguity and explicit pre-dispatch fallback scenarios |
| Broadcast | One settled result per selected incarnation, independent successful siblings, cancellation and empty selection behavior |
| Real hosts | Server and extension together, then actual DevTools server and supported Chromium/Firefox profiles, with separate execution receipts |
| UI reuse | The same selector receives ordinary input from JSON UI and a non-UI consumer |

The bounded released-client experiment found shared endpoint/authentication interference. The separate opt-in upstream patch is still a proposal. SDK integration must resolve that public API/distribution boundary before claiming isolated simultaneous server connections. No mock registry or compile-only adapter counts as the real-host routing proof.

## Initial compact declaration proposal, superseded in part by the clarification below

A single `routing` property can distinguish realm constraints from provider pins without a separate policy factory. Tagged object values avoid interpreting an untagged string through whichever registry happens to contain it. An array represents ordered pre-dispatch fallback, not broadcast:

```ts
routing: { realm: 'devserver' }
routing: { provider: 'project:frontend' }
routing: [{ realm: 'devserver' }, { provider: 'browser:local' }]
routing: (context) => selectRoute(context)
```

These are alternative property values, not implemented exports or an accepted selector type. A namespaced-string alternative would require explicit prefixes such as `realm:devserver` and `provider:project:frontend`. Separate top-level realm/provider fields would need additional rules for their intersection and ordering; one property keeps the fallback sequence in one place. A callback's candidate snapshot, target metadata, cancellation and stale-selection behavior still require review.

The owner accepted the public `defineAction` descriptor as the place for an optional client-visible default, while the action implementation retains its backend handler and execution constraints. A view's action binding or a call can supply a narrower client policy. A callback can run only where its code is installed; it cannot be serialized from a backend-only contribution to a previously unknown client. Remote advertisements can carry validated declarative metadata but not executable JavaScript. Client composition can supply deployment-specific policy without being the only place defaults are declared. Production definitions have not yet gained the accepted default property.

[The request-object type probe](../probes/routing-request-shape/README.md) passes strict TypeScript 7 checking for operation/input/output inference and required-target constraints. It establishes that compact calls are feasible; it does not establish the final routing union or dynamic operation-union inference.

## Connection-isolation follow-up

[Fresh verification](../probes/provider-connection-isolation/proposal/follow-up-20260924/README.md) confirms that the opt-in patch composes with the currently locked declaration repair and passes eight tests, strict TS7 and type-aware Oxlint. Released Devframe 1.0.0 still lacks equivalent public isolation. Kit/hub wrappers can forward the option or accept an owned RPC client. Prebuilt native UI assets contain their own inlined client and are not rewritten by patching the installed Devframe package.

Adopting the exact-version root patch for SDK-owned clients remains an owner decision. It would unblock private workspace transport work; publishing the SDK still needs an upstream release, maintained fork, or explicit consumer patch policy. A fresh browser replay could not start because the in-app browser was unavailable; its runner disposed both hubs and preview. Previous browser passes remain historical evidence, not a new pass.

## Owner clarification after Q6–Q9

The owner accepts public-action routing defaults and proposes a combined selector with required `realm` and optional `provider`. The requested ID types were `string | Symbol`; the exact portable representation remains unresolved. Provider-only selection is a question, not an approved feature. A realm constraint and provider constraint in the same selector must both hold; neither overrides the other.

The current provider descriptor already contains a realm, string ID and incarnation. The generic multi-provider registry is not implemented. Its conflict namespace still needs a decision: provider-only lookup would require registry-wide unique IDs, while a `(realm, provider)` key permits reuse across realms but still requires detecting collisions within a realm. A symbol alone cannot supply cross-runtime identity through JSON or structured-clone transports. Local symbol aliases would need explicit stable-ID mapping; descriptor-backed IDs are the simpler proposal.

The owner also asks why action implementation definitions have a specific helper and two arguments. Dedicated plugin properties do not mandate either factory naming choice. A kind-specific helper supplies the contribution kind; a generic helper would need an explicit kind/descriptor. A fresh single-object declaration probe retains action input/dependency inference and service operation input inference under strict TS7. This removes an inference objection to flattening `contract` or `capability` into the same object as the implementation. Production helpers remain unchanged pending the naming/shape review.

The connection and lifecycle clarifications are explanatory, not patch authorization. Devframe isolation concerns client-side remembered connection/authentication state for multiple backend endpoints. The Vite proposal concerns cleanup of an abandoned replacement after a shutdown hook rejects; it is not a prerequisite for ordinary HMR or build watching. Both proposed runtime patches remain unapplied.
