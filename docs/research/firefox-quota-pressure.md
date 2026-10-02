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

The successful same-client action rules out a permanently unusable database in this observed case. These facts do not justify a new SDK retry or persistence policy. A complete native quota matrix, a portable maintained runner and interrupted/crash evidence remain separate work.

## Reproduction outline

Build the existing Firefox example with `VITE_COUNTER_STORAGE_KEY=example.persisted-counter`, then launch that immutable artifact in an owned native Firefox profile with the reduced preference above. Confirm the native quota principal and saved value before adding pressure. Fill only test-owned keys within the stated bounds, invoke the existing rendered action after each rejected filler batch, and compare both live peers, both status views and actual `storage.local` records. Remove only accepted filler keys, verify the actual quota usage falls, and issue one explicit next action. Retain failure results instead of translating a successful runner exit into acceptance.

The original command was `node /private/tmp/firefox-quota-pilot-fYg75o/pilot.mjs`; the follow-up was `node /private/tmp/firefox-quota-recovery-bzo47fe6/pilot.mjs`. These local investigation scripts are not maintained workspace commands. Promoting them requires a portable fixture and exact native failure/recovery assertions. WebDriver Classic does not provide global page-error capture here. This experiment establishes neither interrupted physical I/O nor browser-crash recovery.
