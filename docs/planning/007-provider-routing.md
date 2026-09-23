# Provider identity, discovery and routing contract

Working deliverable for [issue 7](https://github.com/dvcol/devkit-extension/issues/7). The owner confirmed the identity and discovery ownership below on 2026-09-23. The remaining routing choices are under review. The [research report](../research/provider-routing.md) and its real two-hub evidence establish native integration constraints; they do not implement the complete router.

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

## Current routing review

The following recommendations are questions, not adopted implementation behavior:

1. **Selection composition.** A per-call route replaces the contribution default. An exact provider ID takes priority over an ordered realm preference. Two equally eligible providers are ambiguous until the caller selects one. For example, a `devserver` then `webext` preference can choose the extension when no eligible server exists; it must not choose arbitrarily between two eligible servers.
2. **Pre-dispatch availability.** If a selection disappears before dispatch, consider another candidate only when the route explicitly allows fallback; otherwise fail unavailable. Ordinary calls do not wait indefinitely for a connecting provider. The accepted post-dispatch rule remains no rerouting or automatic replay for any operation.
3. **Broadcast typing.** Separate capability/action broadcast methods return provider-specific settled outcomes. Ordinary invocation remains `Promise<Value>`. One rejected broadcast target does not discard successful siblings.

The owner can answer these independently while local identity and host adapters are implemented. Their answers determine the declaration sketch for routing defaults, callback inputs/results and candidate readiness. Trust filtering, target mapping and state restoration remain owned by their respective linked issues, not implicit additions to this registry.

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
