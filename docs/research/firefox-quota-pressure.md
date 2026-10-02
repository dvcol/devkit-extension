# Firefox quota-pressure investigation

The opt-in persistent extension's native write-failure behavior was exercised on stable Firefox 157.0 in disposable profiles. The [original investigation receipt](../../examples/webext/evidence/persistence/firefox-quota-investigation.json) records `quotaFailureProved: true` and `passed: false`. The [separate recovery receipt](../../examples/webext/evidence/persistence/firefox-quota-recovery.json) preserves that first post-deletion failure, then proves that one further explicit action writes successfully with unchanged provider and client identities. Neither receipt claims immediate recovery or complete storage conformance.

## Fixture and boundaries

The unchanged persistent build included `storage`, omitted `unlimitedStorage` and used `example.persisted-counter`. Its artifact SHA-256 was `afb30dd60980f8cce183b86e40d97ec31ea09ad855df935f6e4b0ba6bfda46ff` before and after the test. Two real native Port clients mounted the existing counter and storage-status views. An independent saved key held 44.

The owned profile set `dom.quotaManager.temporaryStorage.fixedLimit` to 2048 at startup. Native readback confirmed that override and the untouched default of -1. Firefox's actual extension-storage principal reported a 2,097,152-byte limit. This measures native storage behavior under a deliberately reduced ceiling, not the default browser quota. No extension storage API or production handler was replaced.

The test bounded filler writes to 256 attempts and 8 MiB of attempted payload. It used poorly compressible values through native `storage.local.set`, with decreasing chunk sizes. The observed run used 76 attempts, 1,421,312 attempted payload bytes and 73 accepted filler keys. A rejected filler write alone was not treated as proof that the smaller counter record would fail.

## Actual outcome

| Operation                            | Live shared counter | Saved counter | Native outcome                                                                                                                   |
| ------------------------------------ | ------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Confirmed initial actions            | 9                   | 9             | Writes completed                                                                                                                 |
| First pressure checks                | 10, then 11         | 10, then 11   | Small counter writes still fit despite rejected filler                                                                           |
| Rendered action under final pressure | 12 in both clients  | 11            | Both status views reported native `QuotaExceededError`                                                                           |
| Remove all accepted filler keys      | 12                  | 11            | Native deletion succeeded; estimated usage fell to 49,152 bytes                                                                  |
| Explicit next rendered action        | 13 in both clients  | 11            | Both status views reported `An unexpected error occurred`; native `ExtensionStorageIDB` diagnostics recorded `InvalidStateError` |

The independent key retained 44, and native provider identity remained unchanged. No failed write was rolled back in live state, automatically retried or replaced by an SDK persistence mechanism. The test quit the owned browser, confirmed process exit and removed its profile.

The reduced-limit rejection, visible native failure and retained saved records are proved. Immediate successful writing after deletion failed.

## Follow-up recovery

A separate owned run used the same immutable artifact and repeated the native quota failure. Its first explicit post-removal action reached live 13 but left saved 11, with the same native `InvalidStateError`. One further explicitly clicked action reached live and saved 14; both status views reported `Wrote counter 14`. Actual native sender IDs, panel handles/time origins and the provider descriptor were identical before and after both actions. The browser and background were not reset to obtain that recovery.

Only afterward, the test invoked public `chrome.runtime.reload()`. Old extension panels closed. Explicit fresh panels restored saved 14 under a new provider incarnation; their next rendered action saved 15. Browser PID, profile, extension ID and origin stayed unchanged. The recovery receipt records `passed: true` for those observations and `immediateReliefPassed: false` for the still-failed first attempt. The original failed receipt remains unchanged.

Mozilla's inspected source marks a database connection after [quota failure](https://searchfox.org/firefox-main/rev/084057e952e7dbf376f6c3765ad242aec3785dc6/dom/indexedDB/IDBTransaction.cpp#802), converts its next read/write transaction to [cleanup mode and clears the flag](https://searchfox.org/firefox-main/rev/084057e952e7dbf376f6c3765ad242aec3785dc6/dom/indexedDB/IDBDatabase.cpp#568), and [rejects record writes in that mode](https://searchfox.org/firefox-main/rev/084057e952e7dbf376f6c3765ad242aec3785dc6/dom/indexedDB/IDBObjectStore.cpp#918). The matching sequence suggests the panel's deletion used a different connection while the background's next write consumed its cleanup transaction. That attribution is an inference from source and observed outcomes, not direct instrumentation of Firefox's internal flag.

The successful same-client action rules out a permanently unusable database in this observed case. These facts do not justify a new SDK retry or persistence policy. The maintained reduced-limit runner below now passes. Default-quota, interrupted-write and crash evidence remain separate work.

## Reproduction outline

Build the existing Firefox example with `VITE_COUNTER_STORAGE_KEY=example.persisted-counter`, then launch that immutable artifact in an owned native Firefox profile with the reduced preference above. Confirm the native quota principal and saved value before adding pressure. Fill only test-owned keys within the stated bounds, invoke the existing rendered action after each rejected filler batch, and compare both live peers, both status views and actual `storage.local` records. Remove only accepted filler keys, verify the actual quota usage falls, and issue one explicit next action. Retain failure results instead of translating a successful runner exit into acceptance.

The original command was `node /private/tmp/firefox-quota-pilot-fYg75o/pilot.mjs`; the follow-up was `node /private/tmp/firefox-quota-recovery-bzo47fe6/pilot.mjs`. These original investigation scripts are historical evidence. The maintained command below now executes the bounded fixture with exact native failure/recovery assertions. WebDriver Classic does not provide global page-error capture here. This experiment establishes neither interrupted physical I/O nor browser-crash recovery.

## Maintained native command

The [quota runner](../../examples/webext/tests/firefox-quota.ts) reuses the existing native Firefox launcher, counter action and panel helpers. The launcher accepts a native preference record for this disposable test profile. Its existing default-idle path retains the unchanged 30,000 ms native timer and passes again.

Build the opted-in fixture, then run the maintained test:

```sh
VITE_COUNTER_STORAGE_KEY=example.persisted-counter pnpm --filter @devkit/example-webext build
VITE_COUNTER_STORAGE_KEY=example.persisted-counter pnpm --filter @devkit/example-webext exec node tests/firefox-quota.ts
```

Set `FIREFOX_BINARY` when the installed executable is outside the driver's search path. CI runs the same command on pinned Firefox 157.0 after the existing persistent build. No package script or production startup hook is required.

The [maintained receipt](../../examples/webext/evidence/persistence/firefox-quota.json) records the actual 2 MiB native principal, the normalized filler rejection and the rendered counter failure separately. The same run proves live12/saved11, failed explicit13, successful explicit14 with unchanged callers, and native reload restoring14 before saving15. It preserves `immediateReliefPassed: false` while passing the expected native sequence. Both the bounded filler and the counter use actual `storage.local` APIs.

The recorded artifact hash is `40353d1bf35133e0fd074588722e6b7051d5e66c97e3d3c7402c14591f3c40e7` before and after. The final run accepted 73 filler keys in 76 attempts and attempted 1,421,312 bytes, below its 256-attempt/8 MiB bounds. Process exit and removal of the disposable profile are asserted before a passing receipt is written. All four screenshots were inspected: [quota failure](../../examples/webext/evidence/persistence/firefox-quota-failure.png), [first post-relief failure](../../examples/webext/evidence/persistence/firefox-quota-relief-failure.png), [same-client recovery](../../examples/webext/evidence/persistence/firefox-quota-explicit-recovery.png), and [saved value after native reload](../../examples/webext/evidence/persistence/firefox-quota.png).

The original failed investigation and its separate follow-up stay unchanged. The maintained receipt covers reduced quota and the recorded native Firefox sequence. It does not establish default-size quotas, permanent installation, interrupted physical I/O, crash recovery or global page-error capture.
