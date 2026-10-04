# fix(extension): restore a surviving debugger attachment after worker restart

When Chrome preserves an extension debugger attachment after its MV3 worker stops, the replacement provider fails its normal attach for the persisted approved target. Recovery stays blocked by Chrome's already-attached error.

The Chrome adapter first tries normal attachment. For the exact conflict on a persisted target, it sends `Runtime.getIsolateId` through the same extension to verify ownership, then detaches and attaches afresh. Other errors and failed ownership checks propagate without detaching. The existing publisher establishes the new generation and handles normal setup.

## Reproduction

1. Start one native Chrome provider with `recoveryStorageKey`, authenticate it and approve a tab scope.
2. Wait until the native approved scope and target record are saved.
3. Stop that extension's MV3 worker using `ServiceWorker.stopWorker`, keeping the tab open. Chrome retains its debugger attachment.
4. Wake the worker and explicitly reconnect to the same native broker. The released provider repeats `chrome.debugger.attach` and fails with `Another debugger is already attached to the tab with id: <tab>.` Its target remains recovering.
5. With the fix, native restoration verifies extension ownership, resets attachment and republishes the same target with a new generation. Existing pairing and approval remain valid.

The ten source regressions exercise the real Chrome provider, recovery loop and publisher at Chrome I/O and provider-connection boundaries. Four recovery cases fail on the original source; six controls pass. All ten pass with the fix. A separate real Chromium test confirms the worker-stop and physical-attachment behavior.

## Scope and validation

The production change is confined to `src/chrome.ts`, with 14 additions and 2 removals. It follows the existing single provider owner. Command success establishes ownership by this extension, not arbitration between competing managers within the extension. No public API, auth, ownership registry, subscription replay or automatic reconnect policy is added.

Native source checks use upstream `4053273d` and its unchanged frozen pnpm graph. The affected extension package passes all 106 tests with this fix and the independent detached-child cleanup candidate applied. Changed-file native lint, a cold native source typecheck, focused regression types and the extension build pass. Full upstream checks remain for CI.
