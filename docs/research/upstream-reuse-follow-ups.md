# Proposed follow-up comments from the upstream reuse audit

Each section contains a publication-ready comment for the named existing issue. Replace `{{UPSTREAM_REUSE_RESOLUTION_URL}}` with the actual published resolution comment URL before posting. These comments record acceptance for conditional reuse; they do not add reverse dependencies or claim that the experiments have run.

## #5 Contribution and realm contract

[Upstream reuse audit resolution]({{UPSTREAM_REUSE_RESOLUTION_URL}}) supports reusing published RPC/state/JSON contracts through local adapters. The inspected kit context layers Vite fields onto hub and Devframe contexts; these are not mutually exclusive provider identities. The common contract must distinguish provider identity, execution context, UI surface and layered native primitives, with raw handles remaining local.

Acceptance: show valid UI-only, behavior-only and mixed contribution declarations; define minimal action/state/view/lifecycle interfaces and extensible capability outcomes without requiring a complete Node context from extension providers. Renderer action forwarding does not establish routing or authorization policy. [Kit context source](https://github.com/vitejs/devtools/blob/ad2d6df720a513670f93ac09318ae6dc8b4a0623/packages/kit/src/node/context.ts).

## #6 Server adapter contract

[Upstream reuse audit resolution]({{UPSTREAM_REUSE_RESOLUTION_URL}}) identifies `@devframes/vite/hub@1.0.0` and `@vitejs/devtools-kit/node@0.7.5`, including `createPluginFromDevframe`, as released server integration boundaries. Keep their Node/Vite contexts local.

Acceptance: name the public factories and compatible package family; specify setup, authentication, restart and disposal ownership; exercise the shared contribution's state/action success and failure in standalone Devframe and Vite DevTools. Distinguish a live backend serving compiled assets from static snapshots. Do not infer preview integration from the existing `configureServer` hook. [Vite adapter](https://github.com/devframes/devframe/blob/18fa60effeb928eb445add2a536cd44906a59981/packages/vite/src/hub.ts), [kit integration](https://github.com/vitejs/devtools/blob/ad2d6df720a513670f93ac09318ae6dc8b4a0623/packages/kit/src/node/create-plugin-from-devframe.ts).

## #8 State scope and recovery

[Upstream reuse audit resolution]({{UPSTREAM_REUSE_RESOLUTION_URL}}) observed released shared-state patching, sync-ID deduplication and unsubscribe. A real Node MessageChannel probe also showed explicit RPC `$close` rejecting a pending call and removing listeners. Automatic browser Port interruption and worker recovery were not tested.

Acceptance: disconnect a real extension Port with a pending operation and active subscription; require a settled operation and removed listeners, then reconnect without stale or duplicate delivery. Define provider separation, storage authority, schema/version handling, mutation conflicts and worker-restart recovery independently of in-memory patch synchronization. [Shared-state implementation](https://github.com/devframes/devframe/blob/18fa60effeb928eb445add2a536cd44906a59981/packages/devframe/src/utils/shared-state.ts), [RPC channel implementation](https://github.com/devframes/devframe/blob/18fa60effeb928eb445add2a536cd44906a59981/packages/devframe/src/rpc/client.ts).

## #10 Debugger and CDB contract

[Upstream reuse audit resolution]({{UPSTREAM_REUSE_RESOLUTION_URL}}) verified CDB `0.3.0` public exports and browser import graphs. Its Devframe adapter pins the Devframe family at `1.0.0`. Embedded composition remains conditional: only empty-target listing and disposed-client rejection ran, not a Chrome command.

Acceptance: compose the embedded broker with the selected-tab publisher in a real extension; observe command/event, lease, generation, detach and disposal behavior. Measure one native/CDB attachment and domain owner. Repeat through an existing Devframe peer and show logical disposal preserves its host transport. Resolve configurable Fetch activation with the [Injection and transform contract](https://github.com/dvcol/devkit-extension/issues/11): enable/disable are kernel-owned and current subscription activation passes no configuration parameters. [Embedded bridge](https://github.com/dvcol/chrome-debugger-bridge/blob/4053273d6d15ddb17abc3e1b14fc8d58122cb49a/packages/core/src/embedded.ts), [publisher](https://github.com/dvcol/chrome-debugger-bridge/blob/4053273d6d15ddb17abc3e1b14fc8d58122cb49a/packages/extension/src/selected-tab-publisher.ts).

## #11 Injection and transform contract

[Upstream reuse audit resolution]({{UPSTREAM_REUSE_RESOLUTION_URL}}) found a precise CDB gap: `Fetch.enable` and `Fetch.disable` are kernel-owned; subscription demand enables a domain without configuration parameters. This does not establish support for configured patterns or response-stage interception, nor does it prove all Fetch use impossible.

Acceptance: identify a supported configuration and lifecycle owner, then transform a fixture response and prove cancellation/disposal cannot strand paused requests. Otherwise mark the affected operation explicitly unavailable. Do not bypass ownership with competing raw Fetch enable/disable calls. Keep the corresponding Vite transform phase and extension target/frame semantics explicit. [Catalogue](https://github.com/dvcol/chrome-debugger-bridge/blob/4053273d6d15ddb17abc3e1b14fc8d58122cb49a/packages/core/src/cdp-catalogue.generated.ts), [activation code](https://github.com/dvcol/chrome-debugger-bridge/blob/4053273d6d15ddb17abc3e1b14fc8d58122cb49a/packages/extension/src/selected-tab-publisher.ts).

## #12 Renderer and surface contract

[Upstream reuse audit resolution]({{UPSTREAM_REUSE_RESOLUTION_URL}}) verified the renderer asset returned by `jsonRenderUiRenderer()` from `@devframes/json-render-ui/hub@1.0.0` bundles for browsers. The helper is Node-only; no public browser factory export exists.

The public mount contract requires full `DevframeClientContext`, whose RPC transport type is `websocket | sse | static`. Runtime use is narrower, but casts or a fabricated transport value cannot prove a valid extension contract.

Acceptance: choose a supported narrower host interface, wrapper or upstream extension point. Run the same spec with provider-labelled state, successful/rejected/unavailable actions and disposal in real server and Chromium/Firefox extension pages. Cover every required surface and catalog-extension API in the final contract. [Mount type](https://github.com/devframes/devframe/blob/18fa60effeb928eb445add2a536cd44906a59981/packages/hub/src/client/renderers.ts), [RPC type](https://github.com/devframes/devframe/blob/18fa60effeb928eb445add2a536cd44906a59981/packages/devframe/src/client/rpc.ts).

## #13 Live preview and reload contract

[Upstream reuse audit resolution]({{UPSTREAM_REUSE_RESOLUTION_URL}}) found that live hub serving reads renderer files per request with `no-store`, while the client registry caches imported modules. New bytes alone do not replace an already mounted renderer. The renderer package's watch script runs `tsdown`; its full build also runs CSS generation and Vite builds.

Acceptance: observe a renderer edit through watched production build, changed served bytes and actual mounted-view update. Record module invalidation/remount behavior and restoration separately from development HMR. Specify reload/recovery for UI, renderer, content, worker and server changes. Static snapshots remain a separate mode. [Serving code](https://github.com/devframes/devframe/blob/18fa60effeb928eb445add2a536cd44906a59981/packages/hub/src/node/initiate.ts), [registry](https://github.com/devframes/devframe/blob/18fa60effeb928eb445add2a536cd44906a59981/packages/hub/src/client/renderers.ts), [published build scripts](https://registry.npmjs.org/@devframes%2fjson-render-ui/1.0.0).

## #14 Examples and API coverage contract

[Upstream reuse audit resolution]({{UPSTREAM_REUSE_RESOLUTION_URL}}) completes reuse research, not SDK conformance. Its bundle and bounded runtime probes must not become substitutes for the required examples.

Acceptance: inventory every public SDK export, method, hook, behavior-changing option and feature, including deliberately re-exported upstream APIs. Map each to a runnable example and actual host assertions for success or explicit unsupported behavior, plus failure and lifecycle cases. Cover all contribution combinations, the renderer, standalone Devframe, Vite DevTools, Chromium, Firefox and every supported surface/optional adapter. No placeholder packages, compile-only examples or browser mocks count as final integration proof. Avoid wholesale upstream re-exports unless their full supported contract will receive that coverage.

## #16 Release and conformance contract

[Upstream reuse audit resolution]({{UPSTREAM_REUSE_RESOLUTION_URL}}) adopts exact released artifacts and public exports as the baseline: Devframe family `1.0.0`, DevTools/kit `0.7.5`, CDB `0.3.0`. All thirteen baseline tarballs matched registry SHA-512 values; all 150 declared export targets existed. Complete equivalence to upstream source commits is unproved and not assumed.

Acceptance: pin versions and integrity, enforce peer compatibility and public-entry use, and gate upgrades on affected real-host tests plus the complete inventory from [Examples and API coverage contract](https://github.com/dvcol/devkit-extension/issues/14). Track source-only patches explicitly. CDB's Devframe adapter pins `1.0.0`; JSON-render's wrapper requires core `^0.20.0`, so independently adopting upstream `0.21.0` needs compatibility evidence. Require stronger source-build provenance only for a concrete release policy. [CDB adapter metadata](https://registry.npmjs.org/@dvcol%2fcdb-devframe/0.3.0), [JSON-render metadata](https://registry.npmjs.org/@devframes%2fjson-render/1.0.0).
