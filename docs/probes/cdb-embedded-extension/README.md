# Embedded CDB in an actual MV3 worker

Executed 2026-09-29. This is a bounded research fixture for devkit-extension issue 10, not an SDK implementation or a maintained example. No repository dependencies or source files were changed.

## Released artifacts

The public registry still reports `@dvcol/cdb`, `@dvcol/cdb-extension` and `@dvcol/cdb-broker` at **0.3.0**. Their publication timestamps are respectively `2026-09-17T09:25:32.053Z`, `2026-09-17T09:24:38.789Z`, and `2026-09-17T09:24:30.950Z`. They exceed the workspace's seven-day release age. These are the audited release versions, not a newer checkout. `versions.json` records downloaded tarball integrity; all three match the earlier registry audit. Core runtime dependencies resolve to existing unmodified `zod@4.4.3` and `@standard-schema/spec@1.1.0`.

Primary version records:

- https://registry.npmjs.org/@dvcol%2fcdb/0.3.0
- https://registry.npmjs.org/@dvcol%2fcdb-extension/0.3.0
- https://registry.npmjs.org/@dvcol%2fcdb-broker/0.3.0

The browser was cached Chrome for Testing **153.0.8010.12**, observed through Playwright **1.63.0** on macOS. This run does not claim that cached browser is today's stable release. Node **26.9.0** and the workspace Rolldown **1.2.8** built the fixture. The unmodified public imports are `@dvcol/cdb/embedded` and `@dvcol/cdb-extension`. Browser bundling rejected Node builtins and produced no external imports.

## Actual composition and results

`background.mjs` executes inside the packaged Manifest V3 service worker. The HTTP server only supplies a disposable target page; it is not a debugger broker or CDB transport. The extension uses an ordinary packaged control document solely to request and retrieve the proof result.

1. `createEmbeddedChromeDebuggerBridge()` supplies a trusted in-process client and broker.
2. `createSelectedTabPublisher()` receives the real `chrome.debugger.attach`, `detach` and `sendCommand` through its `ChromeDebuggerPort` injection. The instrumentation delegates every call to Chrome; it does not stub replies.
3. Publisher callbacks connect directly to `broker.publishTarget`, `updateTarget`, `revokeTarget`, `publishEvent`, and `bridge.registerTargetExecutor`. The native `chrome.debugger.onEvent` listener forwards to `publisher.debuggerEvent`.
4. `publisher.publish()` attaches the one selected owned tab and configures CDB's flat sessions. `client.acquireLease()` explicitly requests `exclusive-control`; `client.subscribe()` requests `Runtime.consoleAPICalled`.
5. `client.executeCommand(Runtime.evaluate)` returns **42** and the subscription receives the actual console marker emitted by that evaluation. A trusted native call through the same injected port returns **54** while the CDB subscription is active.
6. The subscription closes, its lease is released, and `bridge.client.dispose()` rejects further client use. A trusted native call still returns **63** because the host-owned publisher and broker remain alive.
7. `await publisher.revoke()` runs before `bridge.dispose()`. The event listener is removed. Repeated revoke/dispose produces no extra detach. The extension's direct command after revoke rejects with Chrome's `Debugger is not attached` error; the disposed broker rejects use.

The final `receipt.json` and `run.log` pass assertions for **one attach, one detach, one Runtime.enable and one Runtime.disable**. The disable command is recorded as fulfilled. Native browser shutdown, owned HTTP server shutdown, and disposable profile removal all completed. No credentials appear in these records.

The raw native calls intentionally bypass CDB leases and authorization. They neither attach another session nor alter domain demand. This proves trusted-local composition, not automatic enforcement over arbitrary raw Chrome calls. Playwright observes the target with its own browser debugging connection, so `chrome.debugger.getTargets().attached` remains true after this extension detaches. The extension-specific rejected command establishes our attachment ended; that global flag is not a suitable ownership assertion.

## Source contracts and limitations

The extracted release declarations describe the exact boundary:

- `@dvcol/cdb/dist/embedded.d.ts`: embedded client/bridge disposal is synchronous; executor registration is explicit.
- `@dvcol/cdb-extension/dist/tab-scope-lifecycle-Bl01gyT_.d.ts`: `ChromeDebuggerPort`, selected-tab publisher options and public lifecycle.
- `@dvcol/cdb/dist/broker-CRsevq3j.d.ts`: trusted in-process client authority, leases and subscriptions.

The source-level reference remains https://github.com/dvcol/chrome-debugger-bridge/tree/4053273d6d15ddb17abc3e1b14fc8d58122cb49a . The probe consumes tarballs and does not assume complete source-to-tarball identity.

`Runtime.evaluate` is a debug operation needing an exclusive-control lease. The published grant's `allow` list is additive to its level, not an allow-only filter. The probe grant and principal are trusted fixture setup, not a proposed application approval policy.

`publisher.revoke()` calls its broker revoke callback and attempts native detach in `finally`, but catches native detach errors internally. A resolved revoke promise alone cannot prove Chrome detached; the post-revoke native error supplies that observation here. Subscription close and embedded disposal are synchronous APIs. This run observed completion of its domain disable, not a universal asynchronous drain guarantee.

No navigation, worker termination, user cancellation, permission transition, child-session command, competing lifecycle mutation, DevTools frontend ordering, Firefox capability assertion, remote authenticated Devframe peer, or configured Fetch interception was tested. Published subscription demand still issues `Domain.enable` with no configuration parameters, and the catalogue reserves `Fetch.enable`/`Fetch.disable`. This run does not resolve that transform gap.

No new owner decision is needed to establish this local composition. Before promoting a shared SDK/example contract, the owner must confirm which host lifetime retains the publisher/broker when CDB clients leave and how independent trusted native consumers coordinate that same attachment. This probe preserves native access by disposing only the client first; disposing the entire broker first invalidates the publisher's revoke callback. It does not introduce another broker, lease engine, scheduler, or recovery controller.

## Reproduction and validation

The scratch directory contains exact public tarballs and extracted packages. Core dependencies are symlinked to existing exact-version files in the local CDB checkout. `build.mjs` resolves the installed workspace Vite/Rolldown and `run.mjs` resolves the installed workspace Playwright. Their absolute paths identify this execution environment; adapt these paths to reproduce elsewhere. No package manager install is required in the repository.

```sh
cd /private/tmp/devkit-cdb-embedded.NUsO7Q
node --check background.mjs
node --check build.mjs
node --check run.mjs
node build.mjs
node run.mjs > run.log 2>&1
```

Syntax, guarded browser bundling, and the actual final browser run pass. Applying the maintained repository's type-aware Oxlint preset directly to these untyped scratch `.mjs` files failed: the scratch has no TypeScript project/Node/Chrome declarations, and the script also exceeds a function-length rule. `lint.log` preserves that result. This is executed research, not a claim of strict TS/lint compliance or readiness for maintained source.

Earlier failed receipts are retained rather than overwritten: `preflight-import-failure.json` records an incorrect Node import, `lease-denial.json` records omitted exclusive-control mode, `disposed-broker-order-failure.json` records invalid teardown order, and `any-debugger-attachment-assertion-failure.json` records the overly broad Chrome attachment assertion. Each browser attempt closed its owned browser/server and removed its profile. The preflight attempt never launched a browser; its cleanup booleans record completed optional cleanup calls.
