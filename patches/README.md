# Native dependency patches

These exact-version patches let the private server integration retain TypeScript 7's full declaration checks, including `skipLibCheck: false`, exact optional properties and registry augmentation. They reproduce the [executed compatibility investigation](../docs/research/server-type-compatibility.md). The crossws and h3 changes affect declarations only. The Devframe patch also contains the explicitly adopted client connection isolation change described below.

| Package          | Correction                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `crossws@0.4.12` | Add a type-only `crossws/types` export for the existing common adapter declarations so Node consumers do not import Bun and Cloudflare option types.                                 |
| `devframe@1.0.0` | Import common hooks from that type-only export. Use `Extract` for scoped registry key constraints while preserving indexed node/browser state types.                                 |
| `h3@2.0.1-rc.32` | Import common WebSocket types from that export. Support the ES2023 Error constructor declaration and describe the four optional error fields that can have present undefined values. |

The Devframe package extension supplies its missing declaration dependency on `whenexpr@0.1.2`. The server package explicitly installs `cac@7.0.0` to satisfy Devframe's published optional peer, which its context declarations import unconditionally. Adding cac through `packageExtensions.dependencies` did not install that existing optional peer and must not substitute for the explicit dependency. Neither correction adds an adapter implementation or changes RPC behavior.

Keep these fixes tied to their reviewed versions and remove them when compatible upstream releases pass the same declaration checks. The added `crossws/types` export is a local patch, not a released upstream API. Repository pnpm patches do not automatically reach consumers of a published adapter. External distribution still needs an upstream fix or an explicit consumer installation policy before the server package can claim standalone compatibility.

## Devframe connection isolation

The exact-version `devframe@1.0.0` patch includes the runtime change from [Devframe draft 401](https://github.com/devframes/devframe/pull/401), currently reviewed at [b0856763](https://github.com/devframes/devframe/commit/b0856763d0eb227687fe186f60028f12c37c947e). `connection.isolated` bypasses shared connection discovery, stored browser credentials and authentication broadcasts. The prepared descriptor retains that setting across token updates and reuse. Shared behavior remains the default. `DevframeConnectionDiscoveryOptions` names the unresolved setup input and accepts either shared or isolated mode. Its JSDoc explains that the shared authentication channel carries no backend identity, so it can mix credentials between independent connections; isolated clients still authenticate through their own RPC transport.

```ts
const connection = await setupDevframeConnection({
  baseURL: 'http://localhost:5173/',
  connection: { isolated: true },
});
const client = await connectDevframe({ connection });
```

The maintained [installed-package tests](../packages/server/tests/connection-isolation.test.ts) and [negative type fixtures](../packages/server/tests/connection-isolation.type-test.ts) guard this backport alongside the native server tests. Patching this dependency does not rewrite prebundled upstream UI assets with their own embedded client.

[Vite draft 23574](https://github.com/vitejs/vite/pull/23574) is separate. No Vite dependency patch is installed; the accepted exceptional restart-cleanup gap remains. Both upstream PRs remain drafts for the repository owner to take over.

## Native RPC and shared state over Ports

The `devframe@1.0.0` patch also backports [RPC/state draft 410](https://github.com/devframes/devframe/pull/410) at `fb8cf6a6`. The relevant factory, event and diagnostic sources are identical between v1.0.0 and that draft's v1.1.0 base. The new `devframe/rpc/shared-state` entry uses the native factories and public native types. It retains per-connection subscription metadata and propagates a failed initial snapshot request.

The added browser module is generated from those upstream factories, with `devframe/*` imports external and native browser diagnostics/debug support bundled. Existing Node and client artifacts receive the matching subscription/rejection fixes. The published 1.0 RPC registry's bundled Node-only hash implementation is replaced with its existing public `devframe/utils/hash` implementation, which provides the same stable hash without `node:crypto`. No SDK codec or state engine is introduced.

The maintained WebExtension tests exercise native subscriptions across two Port peers, state writes, disconnect isolation and rejection during initial fetch. The existing 48 native-server tests also pass with the patch, including auth, catalog synchronization, cancellation boundaries and connection isolation. The root patch remains private-workspace installation policy; published consumers do not receive it automatically.

## Native JSON view and renderer exports

The exact-version patches for `@devframes/json-render@1.0.0` and `@devframes/json-render-ui@1.0.0` backport [draft 411](https://github.com/devframes/devframe/pull/411) at `f6c36c33`. `@devframes/json-render/view` re-exports the existing view factory, preserving its registry and index identity with the node entry. Its declarations accept native shared state directly. Default custom-renderer declarations retain the full client context.

`@devframes/json-render-ui/renderer` exposes the existing bundled reference renderer and declares its optional protocol peer. Only the failed-mount cleanup block changes inside that bundle: it disconnects the observer and removes the partial content root before propagating the failure. No renderer implementation, JSON schema or framework is copied into an SDK package.

The installed-package test checks cross-entry duplicate detection, discovery and replacement. The actual patched 1.0 dependency graph passes the 12-scenario Chromium proof, including denied admission and failed-mount cleanup, with zero page errors. This removes the prototype checkout requirement for the runtime APIs; full portable provider/catalog composition and browser surface coverage remain separate work.

## Native renderer action retry

The `@devframes/json-render-ui@1.0.0` patch also backports the two runtime lines from [Devframe PR 416](https://github.com/devframes/devframe/pull/416) at `dc7b205c`. The native action bridge clears its retained error before retrying that same action. Other actions leave the error intact; a new failure replaces it. Successful completion does not clear a failure received while that call was pending.

The maintained Chromium JSON-action and Firefox production tests assert the native alert is visible after unmatched routing rejects, then disappears when the same action succeeds after connecting providers. The Chromium assertion fails against the previous patch despite successful counter updates. No SDK routing, error policy or renderer implementation is added. Remove this backport when a released renderer passes those native regressions. Like the other patches, it is private workspace installation policy, not an automatically distributed consumer fix.

## WXT development tooling

The maintained extension development commands use WXT 0.21.4 and its native web-ext 10.7.0 runner. Two exact-version patches promote the independently replayed [declaration and lifecycle fixes](../docs/research/wxt-adoption-gates.md):

- `@wxt-dev/browser@0.3.0` imports HAR types as module types and uses its own `Browser` namespace for browser aliases. This avoids ambient Chrome/HAR collisions while preserving the native declarations.
- `wxt@0.21.4` generates its i18n declaration from public `Browser.i18n` and retains the runner that actually opened the current browser. Native stop/restart closes that runner even after configuration loading replaces the configured runner. It also compares emitted HTML before/after a successful HTML rebuild, avoiding reloads of unchanged sibling pages while preserving changed-output and missing-snapshot reloads.

The example explicitly installs the optional Rollup declaration peer and web-ext runner peer. Without web-ext, WXT falls back to manual browser startup. Neither patch introduces an SDK watcher, browser launcher or state recovery mechanism. Chrome Developer mode uses normal one-time browser setup in a dedicated persistent profile.

Remove the declaration corrections when a released dependency passes the retained strict TS7 matrix and the maintained example with `skipLibCheck: false`. The maintained Chromium and Firefox development tests now exercise a watched configuration edit through old-browser exit, replacement manifest/provider, working actions and final native stop. Remove the runner correction when these checks pass unpatched in both browsers. No upstream WXT PR has been opened. These patches belong to development tooling; production bundles contain no WXT runner or dev server.

The [HTML reload investigation](../docs/research/wxt-html-reload.md) records why reloading unchanged `devtools.html` removes Firefox's native extension panel after an unrelated `panel.html` edit. The added real-build test covers unchanged output, a transform that changes another page, and missing old output. Remove the HTML correction when that test and both native host development suites pass unpatched. Direct edits to the DevTools registration page retain their native lifecycle.

## CDB subscription activation

The exact-version `@dvcol/cdb@0.3.0` patch registers a subscription before awaiting native domain activation. Released CDB can otherwise discard an event received during that wait. A real Fetch response then stays paused until domain disable because the subscriber never receives its request identifier. The [activation report](../docs/research/cdb-subscription-activation.md) retains the reproduction and reviewed upstream source/test diff.

Failed setup removes the early subscription and rethrows the native error. If the subscription closes during setup, completed activation is released through its original executor, including after target revocation or replacement. Existing domain ownership, public APIs and asynchronous teardown semantics remain unchanged. The patch changes only the emitted broker module; declarations and source maps remain those of the release.

The maintained debugger example tests the installed package at the Chrome I/O boundary. A separate real-browser proof gates completion of an actual successful `Fetch.enable` call to reproduce the event ordering. Remove the patch when a released CDB passes that regression and the retained invalidation tests unmodified. No CDB upstream PR has been opened; the prepared draft requires owner approval. This remains private workspace installation policy and does not automatically reach published consumers.

## CDB worker attachment recovery

The exact-version `@dvcol/cdb-extension@0.3.0` patch corrects [reproduced worker restoration failure](../docs/research/cdb-worker-recovery.md). Chrome retains this extension's debugger attachment when the MV3 worker is force-stopped, but the released native provider always tries to attach again and cannot restore its approved target.

Only an exact attachment conflict while restoring a persisted target permits the native ownership check. A successful `Runtime.getIsolateId` through this extension's debugger API precedes detach and fresh attach. This resets the Chrome session to match the new publisher's domain and child-session bookkeeping. Other errors, failed ownership checks and reset failures propagate. Existing native broker/scope validation, generation advancement, pairing and recovery timing remain unchanged. The patch adds no public API or SDK recovery controller.

The maintained browser test proves explicit native reauthentication, retained pairing without another confirmation, restored scope/target at the next generation, stale-generation rejection and final native cleanup. The source candidate stays native and assumes its existing single debugger owner; it does not arbitrate competing managers within the same extension. Remove the patch when a native release passes the focused negative checks and real worker regression. It changes only the emitted Chrome provider module; declarations and source maps remain those of the release. No upstream PR has been opened, and private workspace patches do not automatically reach published consumers.

## CDB detached-child demand cleanup

The same exact-version `@dvcol/cdb-extension@0.3.0` patch corrects cleanup after a real child frame disappears while a lease retains its native command/subscription demands. Detachment clears both the child route and its demand set. Released `setSubscriptionDemand` then rejects inactive cleanup by resolving the missing child before checking its existing idempotence guard. The maintained Chromium fixture observed two provider errors on lease release: `The requested session is not available.`

The added hunk only moves the existing demand lookup/idempotence guard before child-session resolution in the emitted selected-tab publisher module. Missing-child activation and commands still reject. Method validation, live-child disable and native disable failures retain their behavior. There is no new catch, retry, recovery controller or public API. The existing worker-restoration hunk is unchanged; declarations and source maps remain those of the release.

Four [public-publisher tests](../examples/debugger/tests/child-sessions.test.ts) cover the native Chrome I/O boundary: two detached-demand cases fail before the correction and all four pass afterward. The [real Chromium check](../examples/debugger/tests/remote/child-sessions.ts) verifies genuine child commands/events, removal with an active lease, stale rejection, root continuity and error-free cleanup through authenticated Devframe. Remove this correction when a released native dependency passes those same cases without it. No upstream PR was opened. This remains private workspace installation policy rather than an automatically distributed consumer fix.
