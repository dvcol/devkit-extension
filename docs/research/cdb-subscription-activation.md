# CDB events during subscription activation

Released CDB 0.3.0 can lose an event while `subscribe()` awaits native domain activation. A controlled real Chromium test reproduced this with `Fetch.requestPaused`: the browser paused a response, the native publisher forwarded the event, but the broker had not registered the subscription. The page request remained pending until native domain disable.

This is a CDB lifecycle bug. The SDK adds no event transport, broker or recovery protocol. The exact-version [pnpm patch](../../patches/@dvcol__cdb@0.3.0.patch) applies the reviewed native correction. [Debugger and CDB contract](https://github.com/dvcol/devkit-extension/issues/10) remains open.

## Reproduction and correction

The probe lets the real `Fetch.enable` succeed, holds completion of the port promise, and makes a real matching request. It releases the promise only after observing the actual Chrome pause event. This establishes a permitted ordering; it does not measure how often the race occurs without the gate. Neither the protocol event nor the response is mocked.

```mermaid
sequenceDiagram
  participant Client
  participant Broker as CDB broker
  participant Chrome as Native port / Chrome
  Client->>Broker: subscribe(Fetch.requestPaused)
  Note over Broker: Patch registers subscriber here
  Broker->>Chrome: Enable Fetch
  Chrome-->>Broker: Actual pause event while enable promise is pending
  Note over Broker: Released 0.3.0 drops event; patch buffers it
  Chrome-->>Broker: Enable promise resolves
  Broker-->>Client: Subscription ready
  Broker-->>Client: Patched subscription yields buffered event
  Client->>Chrome: Read and fulfill through native CDB
```

The upstream candidate changes **14 added / 5 removed production lines** in the broker. It registers the existing subscriber before awaiting activation. Failed setup closes that subscriber and propagates the original error. If it closes while setup is pending, successful late activation releases demand through the captured original executor. Revocation can remove that executor from the registry, so looking it up again would lose cleanup or target the wrong lifecycle.

| Case during activation               | Verified behavior                                               |
| ------------------------------------ | --------------------------------------------------------------- |
| Event arrives                        | Buffered and delivered once after setup                         |
| Setup rejects                        | Subscriber removed, original error preserved, later retry works |
| Buffer overflow                      | Closed subscriber stays closed; completed demand is released    |
| Lease release or expiry              | No live subscription is returned after invalidation             |
| Target revocation or broker disposal | Original executor receives one enable and one disable           |
| Replacement target generation        | Cleanup reaches the original executor, never the replacement    |

No public signature, declaration, protocol field or domain scheduling policy changes. Existing asynchronous disable still catches native failures; this patch does not make lease release an acknowledged cleanup barrier.

## Validation and provenance

The [retained candidate source diff and tests](../probes/cdb-subscription-activation/README.md) contain eight focused regressions. Unmodified broker source fails seven; the setup-rejection retry already passes. The candidate passes all eight and all **80 affected core tests**. Upstream lint, core and test-inclusive type checks, and the core build pass. Checks target the affected package, not the whole upstream workspace.

The disposable source checkout's manifest says 0.2.0. Its broker base is byte-identical to the broker embedded in released 0.3.0 and the inspected upstream main blob `c5fe529a021a94850cad208442a3e4ddd129e32a`. That broker SHA-256 is `7130cce247462d4d6c2af453562d8a6b813ab4f4d647bb09e19fb3aa14be62fb`. This is source-file equivalence, not a claim that whole releases or revisions match.

The workspace patch translates that source correction into 0.3.0's emitted broker module. The maintained [installed-package regression](../../examples/debugger/tests/subscription.test.ts) fails unpatched and passes patched. All **10 debugger tests**, strict TypeScript 7, Oxlint, Oxfmt and both extension builds pass. The maintained Chromium and Firefox examples pass against the installed patched dependency.

The [first full CI run](https://github.com/dvcol/devkit-extension/actions/runs/36540361357) caught an unused patch in the isolated packed-adapter consumer, which does not install the debugger example or CDB. Its existing example-dependency exclusions now include CDB. The corrected consumer passes packing, strict Bundler/NodeNext declarations, native hosts and browser RPC without disabling pnpm's unused-patch check.

The separate real-browser replay uses the installed patched 0.3.0 through normal public package imports. It receives the formerly lost Fetch event once and fulfills the actual response before closing the subscription, releasing its lease or detaching. Its source, dependency resolution and receipt are retained with the reproduction.

The second browser case closes a subscription after a completed body read. The response remains paused while its command lease owns demand. Releasing that lease triggers a successful native `Fetch.disable`, resumes the original response before detach, and allows another matching request normally. This agrees with native lease ownership; no SDK cancellation mechanism is needed for this case.

## Limits and upstream handoff

The browser result covers a root session, a fixed host response pattern and a completed body read. In-flight body-read cancellation, other simultaneous domain demand, child sessions, streams, queue overload and failed native teardown remain separate acceptance work. Registering earlier does not repair a later dropped event.

The [prepared draft description](../probes/cdb-subscription-activation/upstream-draft.md), source diff and tests are ready for review. No CDB PR has been opened. Remove the local patch once an upstream release passes the same regressions unmodified. The patch remains private workspace installation policy and does not accompany a published consumer automatically.
