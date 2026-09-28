# Native extension Port integration proof

Local proof for [routing #7](https://github.com/dvcol/devkit-extension/issues/7) and [renderer #12](https://github.com/dvcol/devkit-extension/issues/12), following the owner's accepted native integration direction. It uses candidate public Devframe exports, built from the separate upstream prototype based on `9aa752a1` / v1.1.0. The maintained `@devkit/webext` channel uses v1.0.0. The native shared-state and renderer exports still come from the reviewed upstream drafts.

The extension contains a module service worker and two instances of one packaged page. Both pages mount the existing JSON renderer. The worker publishes its view through native shared state. Application action handlers, state synchronization, subscription identity and serialization all use Devframe/birpc. `@devkit/webext.createPortChannel()` connects native channel hooks and disconnect handling to `runtime.Port`. The example imports its built package export.

```mermaid
flowchart LR
  PageA[Extension page A / native renderer] -->|runtime.Port A| Worker
  PageB[Extension page B / native renderer] -->|runtime.Port B| Worker
  Worker[Worker / actual sender admission] --> RPC[Native RPC functions + connection metadata]
  RPC --> State[Native shared state + JSON view]
  State -->|Native broadcasts| PageA
  State -->|Native broadcasts| PageB
```

## Review commits

- [RPC/state draft #410](https://github.com/devframes/devframe/pull/410), narrowed to [fb8cf6a6](https://github.com/devframes/devframe/commit/fb8cf6a6).
- [JSON renderer/view draft #411](https://github.com/devframes/devframe/pull/411), [f6c36c33](https://github.com/devframes/devframe/commit/f6c36c33).
- [Baseline snapshot repair #412](https://github.com/devframes/devframe/pull/412) is independent and changes no runtime code.

The split removes the renderer declaration shim and implementation file moves. Native diagnostics stay in their original module. RPC/state passes its six focused tests, package type check, lint, Knip and browser build guard. JSON rendering passes its affected builds, type checks, focused tests and 30 API snapshot checks. The combined runtime is the two feature commits above, applied to `9aa752a1`.

## Run against the prototype

Build the changed `devframe`, `@devframes/hub`, `@devframes/json-render` and reference renderer outputs in the upstream checkout first. The browser proof imports their package exports without source aliases, private imports or fabricated Node/hub contexts.

```sh
pnpm --filter @devkit/webext build
pnpm with current --dir docs/probes/native-port install --ignore-workspace --ignore-scripts
node docs/probes/native-port/prepare.mjs /path/to/built/devframe-prototype
cd docs/probes/native-port
node node_modules/typescript/lib/tsc.js --noEmit
node build.mjs
node check.mjs
```

`prepare.mjs` links already installed upstream tools, built upstream packages and the maintained WebExtension package into this isolated probe. TypeScript comes from the SDK's TS7 installation. Native declarations currently also reference Node types; these are compile-time dependencies, and the Vite browser build contains no Node runtime. `check.mjs` uses the installed Playwright Chromium with a disposable profile, closes it afterward and removes the profile. The in-app browser cannot load unpacked extensions.

Alternatively, load `dist` unpacked in Chromium and open its options page twice. The extension requests no host permissions and admits only the exact packaged `panel.html` URL and its own extension ID. `denied.html` exercises a rejected sender. No content/page bridge is admitted by this fixture.

## Confirmed live behavior

[The recorded run](./receipt.json) used Chromium 153.0.8010.12 and completed with zero page errors:

- A native renderer action updated both pages from 0 to 1.
- Concurrent identity calls retained distinct actual Port session IDs across an asynchronous handler.
- A native state write from a page updated both views to 10.
- A `Map` containing `BigInt` survived Chrome's JSON transport using native structured-clone records. A function-bearing payload rejected.
- Closing a page connection rejected its pending call and unmounted its renderer. The worker completed the entered action once after the other page released it.
- Reopening the page observed the worker's retained value. Its action was not replayed, and both pages could advance to 11.
- Denied sender admission rejected mounting and removed the renderer's partial DOM. A worker-initiated disconnect closed only its own peer.

The service worker registers listeners synchronously. Its native initial states are supplied as existing `SharedState` instances, so startup needs no top-level await.

![Native JSON renderer over real extension Ports](./native-port-proof.png)

## Scope and outstanding work

This is a native integration proof, not a published WebExtension provider. It does not claim the portable provider catalog/router integration, browser toolbar popup lifecycle, DevTools/side-panel surfaces, content/page bridge, debugger, worker suspension recovery, Firefox conformance or extension HMR. The prototype deliberately keeps native state ownership and write semantics. Worker termination can reset in-memory state; persistence remains contribution/host-owned.

The native diff exposes the shared-state factories, browser renderer and view publication dependencies. It also fixes initial snapshot rejection propagation and partial renderer cleanup when mounting fails. Existing renderer declarations retain the full hub context by default; only the reference renderer opts into the smaller RPC context. No new upstream PR or downstream dependency patch is authorized by this evidence alone.

References: [Chrome Port messaging and serialization](https://developer.chrome.com/docs/extensions/develop/concepts/messaging), [Playwright extension testing](https://playwright.dev/docs/chrome-extensions).
