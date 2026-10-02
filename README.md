# Devkit Extension

A framework-neutral contribution SDK for development-server and WebExtension providers. The monorepo is being rebuilt from the former Vue extension template. The settled [architecture](./ARCHITECTURE.md), [glossary](./GLOSSARY.md) and [implementation map](https://github.com/dvcol/devkit-extension/issues/1) define the intended behavior. Host adapters, renderer integrations and browser examples remain implementation work.

Prefer Devframe's public APIs over new SDK facades. The [upstream compatibility rule](./ARCHITECTURE.md#upstream-compatibility-and-minimal-adapters) and [implementation/map review](./docs/research/upstream-alignment-review.md) identify what is reused and which gaps justify local code.

Use Node 24 or newer and the pnpm version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm --filter @devkit/core build
pnpm --filter @devkit/core typecheck
pnpm --filter @devkit/core lint
pnpm --filter @devkit/core test
pnpm --filter @devkit/core format:check
```

Contracts use `defineCapability` and `defineActionContract`. Backend implementations use `defineService` and `defineAction`. `defineView` gives native publication a contribution-owned setup/cleanup lifetime with typed capability requirements. Each helper takes one declaration object. See the [helper table](./ARCHITECTURE.md#declaration-helpers) for their inputs and plugin placement.

Packages live in `packages/*`, runnable host examples in `examples/*`. Vite builds JavaScript and TypeScript 7 emits declarations and checks source, tests and build configuration. Package builds must not import browser or server host dependencies into the portable core.

The [UI-free contribution example](./examples/contribution/README.md) runs a shared capability and action through the local provider lifecycle. It demonstrates separate contract/provider entry points, typed native context, dependency activation, schema validation and owned cleanup. Run it through built package exports:

```sh
pnpm --filter @devkit/example-contribution... run build
pnpm --filter @devkit/example-contribution run demo
```

The [packaged script example](./examples/webext/README.md#packaged-document-start-scripts) verifies native `document_start` behavior in MAIN and ISOLATED worlds on Chromium and Firefox, through both production Vite and WXT development builds. `defineScript({ id, execution, requires?, setup })` owns registration and native cleanup through the existing contribution lifecycle. The Vite example uses the same API to own live HTML-hook activation on Devframe and DevTools. Native tooling still packages code; executed effects and completed production HTML are not rolled back by runtime cleanup. [Contract and boundaries](./docs/planning/011-portable-script-declaration.md).

The [native HTML transform example](./examples/vite-hosts/README.md) uses `defineTransform({ id, execution, requires?, setup })` for two independently owned Vite hooks on Devframe and DevTools. Native hook order, HTTP failure and completed build output remain Vite behavior. The shared contribution API supplies registration lifetime and explicit cleanup. [Transform contract and remaining native implementations](./docs/planning/011-portable-transform-declaration.md).

The [core proof matrix](./docs/contracts/CORE-API-MATRIX.md) records local evidence and the remaining host obligations. A passing local lifecycle example does not complete the Devframe, DevTools, Chromium or Firefox integrations.

The [headless server examples](./examples/server-contexts/README.md) reuse those same contracts in genuine Devframe hub and DevTools kit contexts through [`@devkit/server`](./packages/server/README.md). Both execute actions against native shared state, disable and re-enable their service, and dispose owned commands while retaining host state. They use built public package exports and open no network listener.

```sh
pnpm --filter @devkit/example-server-contexts... run build
pnpm --filter @devkit/example-server-contexts run demo:devframe
pnpm --filter @devkit/example-server-contexts run demo:devtools
pnpm --filter @devkit/example-server-contexts run demo:routing
pnpm --filter @devkit/example-server-contexts run test
```

The [routing client](./packages/client/README.md) composes those local providers. `demo:routing` runs both hosts simultaneously, exercises fallback and callbacks, rejects an incomplete broadcast before either counter changes, and dispatches overlapping selectors once per provider. Client disposal retains native state and host ownership.

The same package's `demo:remote` uses the provider's `expose` startup declaration to run its action and capability operations through real authenticated native WebSocket RPC on both hosts. It proves authorization and input rejection, contribution disposal, incarnation checks, retained state and client rejection on host shutdown. Native server handlers can still finish after disconnect, as accepted for remote calls. `demo:browser devframe` and `demo:browser devtools` additionally run the shared router through the native remote adapter and its authorized catalog query; the browser page can be reloaded without resetting backend state.

The [native Vite host examples](./examples/vite-hosts/README.md) mount the released Devframe hub and Vite DevTools plugins. Both render the shared native JSON counter in the browser, dispatch portable actions and capability calls, and observe native state across tabs. Tests also cover HTTP startup, delayed cleanup, config-watcher restarts, fresh incarnations and client-module invalidation. Run `pnpm --filter @devkit/example-vite-hosts demo:devframe` or `demo:devtools` after building that example's dependency graph.

Both hosts also have maintained production-preview examples. Run `pnpm --filter @devkit/example-vite-hosts build:site`, then `preview:devframe` or `preview:devtools`. Each serves the same built browser UI with a live native backend. The browser tests authenticate with native OTPs and verify shared updates, unmount/remount, explicit disconnect/reload and backend shutdown.

The browser example also observes native shared state across tabs. Disconnect marks its retained value stale; reload reconnects and reads the current snapshot. [Live checks on both server hosts](./docs/research/native-state-observation.md) confirm that behavior while keeping provider values separate.

The [native JSON renderer example](./examples/json-render/README.md) renders the same counter through the published Devframe renderer on both native backends. Its browser-safe view recipe also runs in Vite and extension providers; disabling a view or losing its required capability removes its native publication while host-owned counter data survives. It demonstrates native action validation, peer updates, unmount/remount and disconnect cleanup, with framework-neutral JSON authoring. Build its dependency graph, then run `pnpm --filter @devkit/example-json-render demo devframe` or `demo devtools`.

The maintained [`@devkit/webext`](./packages/webext/README.md) package binds an admitted `runtime.Port` to native Devframe RPC and serialization. The [extension example](./examples/webext/README.md) composes the shared [`@devkit/devframe`](./packages/devframe/README.md) provider/catalog adapter with the existing router and records live Chromium and Firefox checks in its versioned browser receipts. One page connects to explicitly configured Devframe and DevTools servers alongside the extension worker, using the same counter contracts, native authentication, realm broadcast and pre-dispatch fallback. A selected local page can also hand off its natively published connection. Native shared-state and renderer exports use exact-version backports of the reviewed upstream drafts. Both browsers exercise mixed-provider routing, selected-page handoff and actual popup/options, DevTools panel and browser sidebar lifetimes with native state retention. The [view lifecycle example](./examples/webext/VIEW-LIFECYCLE.md) records contribution removal, reenabling and independent business state. Automatic discovery, injected hosts and complete browser lifecycle coverage remain open.

Watched production publication also retains the last complete build and reports failed rebuilds. Run the independent `build:watch` and `preview` scripts or their combined `dev:production` command in the [Vite example](./examples/vite-hosts/README.md). Its browser tests keep an older page and a new production generation connected to the same provider and counter state. Automatic production-page refresh, endpoint discovery, injected-client authority and complete browser lifecycle coverage remain open. Each example README records its tested boundaries; the Vite example also records the accepted unpatched cleanup gap.

The [debugger example](./examples/debugger/README.md) composes CDB's embedded bridge, selected-tab publisher and native lifecycle helper with a portable page-title capability and action. The Chromium host owns the attachment; disposing its contributions releases their work while preserving the host. Live tests cover navigation, explicit revocation, tab closure and unsupported-page cleanup. Firefox exposes the unavailable capability through the same contribution runtime. The same title contract also runs through an authenticated native CDB server provider. Its real browser check proves that a separate caller needs its own grant, then verifies exact generation checks, lease cleanup, cancellation during a real pending command, contribution disable/enable and retained ordinary RPC. This private, UI-free example uses the documented subscription activation patch. The maintained fixed-response recipe also proves native Fetch filtering, body replacement and teardown. Dynamic CDB transform contributions, native disconnect/revocation during remote execution and the complete debugger lifecycle remain open.

```sh
pnpm exec turbo run build --filter=@devkit/example-debugger... --concurrency=1
pnpm --filter @devkit/example-debugger test
pnpm --filter @devkit/example-debugger test:browser
pnpm --filter @devkit/example-debugger test:firefox
pnpm --filter @devkit/example-debugger test:devframe
```

Oxlint checks correctness, suspicious and pedantic rules as errors, plus explicit TypeScript, imports, promises and test rules. Type-aware linting is enabled. Warnings fail checks. Oxfmt controls formatting, and `format:check` fails on drift. See [tooling conventions](./docs/TOOLING.md) for the enforced rules, documented exceptions and review obligations.

```sh
pnpm tooling:lint
pnpm tooling:typecheck
pnpm tooling:test
pnpm exec oxfmt --write path/to/changed-file.ts
pnpm exec oxfmt --check path/to/changed-file.ts
```

Keep local validation scoped to the changed package or dependency graph. `pnpm ci` is the full repository gate used by GitHub Actions. Historical probes under `docs/probes` preserve exact executed evidence and are separate from maintained packages and examples.

The previous template's publishing and deployment workflows have been removed. Package publishing, browser-store releases and example deployment will be established through the release contract in [issue 16](https://github.com/dvcol/devkit-extension/issues/16).
