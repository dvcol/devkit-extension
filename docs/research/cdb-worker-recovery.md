# Native debugger attachment recovery after worker termination

This investigation advances [Debugger and CDB contract](https://github.com/dvcol/devkit-extension/issues/10). A real Chromium 153.0.8010.12 run reproduced a released `@dvcol/cdb-extension@0.3.0` recovery failure. The correction belongs to the native Chrome provider; the portable SDK does not supervise workers or recover debugger sessions.

## Reproduced failure

The maintained example already stores native installation identity, IndexedDB pairing and an approved scope/target record through `recoveryStorageKey`. Approval queues persistence asynchronously, so the test waits for that native record before terminating the worker. It targets only the owned extension's background script through public `ServiceWorker.stopWorker`.

The native host observes the provider disconnect, marks its target and grant as recovering, and retains no lease. Waking the replacement worker through its existing message listener creates no Devframe connection. The test explicitly runs setup again with the same host and a fresh native authentication code. Native authentication succeeds.

Chrome retains the extension's debugger attachment across this forced termination. A harmless `Runtime.evaluate` from the extension's control page succeeded before reauthentication, proving same-extension ownership. The native provider then repeatedly failed its normal `chrome.debugger.attach` call with `Another debugger is already attached to the tab with id: <owned tab>.` Its grant remained recovering and the maintained restoration check timed out. Temporary error instrumentation was confined to an ignored generated bundle and removed by rebuilding.

```mermaid
sequenceDiagram
  participant Browser as Chrome
  participant Old as Original worker
  participant Host as Native CDB broker
  participant New as Replacement worker
  Old->>Browser: Attach and publish approved tab
  Browser->>Old: Force worker termination
  Host->>Host: Retain scope; mark provider/target recovering
  Note over Browser: Debugger attachment survives
  New->>Host: Explicit native authentication and pairing
  New->>Browser: Native attach for persisted target
  Browser-->>New: Already attached
  Note over New,Host: Released recovery cannot restore the grant
```

This is forced worker termination in an owned profile, not a natural-idle test. It does not establish automatic startup, browser-restart persistence or credential UX.

## Narrow native correction

The [source candidate](../probes/cdb-worker-recovery/chrome.patch) changes only the Chrome provider's attachment helper and its existing callback. The [installed exact-version patch](../../patches/@dvcol__cdb-extension@0.3.0.patch) changes the corresponding emitted module. No declaration or public API changes.

```text
normal native attach
  succeeds -> continue existing publication
  unrelated failure -> propagate
  exact already-attached conflict on a persisted target
    -> Runtime.getIsolateId through this extension's native debugger API
    -> if ownership check fails, propagate without detaching
    -> detach the verified extension attachment
    -> attach afresh, then continue existing native publication
```

The native restoration path already checks the saved broker identity and surviving approved scope. A new publisher has empty domain-demand and child-session bookkeeping, so keeping the previous Chrome session would require further reconciliation. A fresh attachment matches the existing restoration's new target generation. It does not replay commands or preserve prior subscriptions.

The patch does not use `getTargets().attached`, which cannot identify the owning extension. Chrome's successful command proves extension ownership, not ownership by an arbitrary manager inside that extension. This example retains its established single CDB owner. Independent managers must honor that owner; the patch does not create an extension-wide lock or promise coexistence with competing raw debugger owners. An unrecognized browser error remains a failure.

## Maintained browser acceptance

Run the affected build and `pnpm --filter @devkit/example-debugger test:devframe`. The [worker check](../../examples/debugger/tests/remote/restart.ts) runs before the existing caller-aware contribution checks and final native disposal.

| Observation        | Required result                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| Native persistence | Current approved scope and target generation saved before termination                               |
| Termination        | Owned worker stops; native peer disconnect settles; no lease                                        |
| Wake               | In-memory connection is absent; no automatic setup                                                  |
| Explicit setup     | Missing/invalid credentials reject; new native code authenticates                                   |
| Pairing            | Same installation/provider identity; no second pairing confirmation                                 |
| Restoration        | Same scope, principal and target ID; generation increases by one; binding ID changes                |
| Contributions      | New-generation title succeeds; previous pinned generation rejects; other authority tests still pass |
| Final teardown     | Native attachment relinquished; ordinary RPC survives client disposal; scopes/leases cleared        |

The unpatched browser regression failed at native provider restoration. It passes with the patch and records its results in the maintained [native receipt](../../examples/debugger/evidence/devframe.json). Auth secrets remain in memory and temporary native stores.

The ten [maintained installed-package checks](../../examples/debugger/tests/chrome-recovery.test.ts) cover normal attachment, absent recovery identity, unrelated errors, failed ownership verification, reset ordering, detach failure and failed reattachment. They exercise the actual native provider through its Chrome and connection boundaries. The same cases pass against the candidate source and installed patch; four recovery cases fail against the released source while six controls pass. Source verification and receipts are retained under [the probe directory](../probes/cdb-worker-recovery/). Remove the local patch when a released dependency passes those checks and the maintained real-browser regression unchanged. No new upstream PR has been opened. Broader worker failure races, same-peer reattachment and the pending renderer/interception decisions remain separate work.
