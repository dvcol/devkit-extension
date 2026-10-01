# Executable API inventory

[Examples and API coverage contract](https://github.com/dvcol/devkit-extension/issues/14) owns this inventory. It complements the broader obligations and historical receipts in [CORE-API-MATRIX.md](./CORE-API-MATRIX.md).

[`api-coverage.json`](./api-coverage.json) lists each exported name and SDK-owned member path explicitly. The checker discovers package entry points from `packages/*/package.json` and reads their built declarations through the pinned TypeScript 7 public compiler API. Adding or removing an export, subpath or nested hook without updating its entry fails CI.

The inventory includes inherited SDK members, union-specific members, nested anonymous objects, class instance/static members, stable computed names and anonymous factory return handles. It excludes private/protected class members and expansion of vendor-owned types. Native aliases still have entries. Generic mapped types are inventoried as declared contracts; discovery does not instantiate every possible consumer type. Named return contracts have their own exported entries. Keep public named return contracts exported when adding APIs.

The TypeScript entry point is explicitly named `typescript/unstable/sync`. No private compiler API, handwritten TypeScript parser or additional dependency is used. The version is pinned; the scanner regression tests must pass when upgrading it.

## Evidence records

| Field | Meaning |
| --- | --- |
| `id` | Stable group name for related API obligations |
| `apis` | Exact compiler-discovered names, without wildcard coverage |
| `examples` | Maintained example directories with package manifests |
| `evidence` | Workspace, test file, exact Vitest `fullName`, host and execution mode |
| `browserEvidence` | Generated receipt, exact asserted scenarios, native browser/host/mode and required page-error capture |
| `gaps` | Unfinished evidence or host/mode obligations; any remaining gap blocks the completion check |

The linked groups currently associate 320 API paths with 179 distinct executed tests. They cover declaration factories, runtime activation/admission/invocation and provider lifecycle, local routing and ownership, native Devframe exposure/action bindings, Port composition, genuine Devframe/DevTools contexts and authenticated Devframe HTTP/WebSocket connections. JSON and structured-clone Port fixtures run through Node MessageChannel; they do not count as Chromium or Firefox acceptance. Headless server tests do not count as Vite, browser or production-preview evidence. Some type-only contracts and remaining entries stay explicitly unmapped while existing evidence is reconciled. Unmapped does not mean untested.

The native provider-connection group also links an actual authenticated WebSocket session-revocation sequence. It checks exact native auth-error delivery, cleared availability, completion of dispatched backend work without replay and a fresh adapter after explicit native reauthentication. Persisted credentials, browser authentication UI and other transport-error classes remain separate gaps.

The custom-kind group links the inert declaration factories and application-supplied installer to a runnable native command in both headless hosts. Its exact tests prove the declared ID/payload, disable/reenable, native unregistration and final disposal through built example exports. Local schema rejection before setup remains separate evidence; browser/reload and generic type-contract gaps remain explicit. A second group links the portable operation-error guard to its native-error, portable-record and malformed-diagnostic cases without claiming every error variant or transport behavior.

The Port declaration group executes strict TypeScript consumers against the actual built exports, installed Chrome and WXT Port declarations, and native Devframe channels. Positive composition must compile cleanly; each malformed consumer must produce exactly its intended compiler diagnostic. WXT uses Chrome-derived declarations, so this evidence remains separate from native Firefox runtime acceptance.

Vitest produces its normal JSON report through its built-in reporter. The checker requires the exact file and test name to appear once with `passed` status in a successful run. Missing, renamed, skipped, todo, failed or duplicated results cannot satisfy the entry. Example and test files must exist. Test authors still own meaningful assertions; matching a passed name alone cannot assess test quality.

Browser references currently link 46 distinct scenarios from four generated Chromium/Firefox receipts. They prove production-extension Port composition/disconnect, native JSON action bindings and action broadcast with native development-server connections. The action-binding group also checks native input/success/error callbacks, provider-owned applicability, partial failure and absence of backend effects from a retained Chromium button after unmount. Its Firefox and development/preview gaps remain explicit. A separate capability-broadcast group proves native reads across all three provider hosts, realm/provider selection, service disable/enable and successful siblings after a provider disconnects. It retains its untested browser error/lifecycle cases. The disconnect group also stops an actual Chromium service worker, observes pending-call rejection and local unmount, verifies both independent native server backends remain usable, and reconnects fresh documents to a new provider incarnation with reset ephemeral state. The opt-in persistence receipt adds explicit fresh connections after forced worker termination with a confirmed saved value, a new provider incarnation and one set of native mounts per client. It does not add SDK storage APIs or change the linked API-path count. These references do not prove exact native listener counts, natural idle suspension, Firefox event-page suspension or the complete development/preview matrix. The checker requires each exact scenario once, the tested browser version and no captured page errors. Firefox’s explicit lack of global page-error capture remains in the report. Other receipt formats, including debugger reports, are not accepted as evidence by this checker.

The generated `.conformance/report.json` records every API path, examples, host/mode, test result and outstanding gap. Vitest references retain the native run timestamp. Browser references retain their receipt file modification time, which is not a test-run identity or freshness guarantee. CI runs the browser gate after its native browser commands and retains the report and generated receipts as the `api-conformance` artifact. Turbo also caches the native report as a test output, so cached tests retain their original execution timestamp. Local checks read generated reports; rerun affected tests after changes rather than treating old reports as fresh execution. For browser evidence, clear the named generated receipts first and require each command to succeed. The checker never uses committed `evidence/` snapshots. A failed gate removes the previous aggregate report before validation.

## Commands

Build affected package declarations before inventory checks. For the currently mapped evidence, run:

```sh
pnpm --filter @devkit/core test
pnpm --filter @devkit/example-contribution test
pnpm --filter @devkit/runtime test
pnpm --filter @devkit/devframe test
pnpm --filter @devkit/client test
pnpm --filter @devkit/webext test
pnpm --filter @devkit/server test
pnpm run conformance:test
pnpm run conformance:check
```

The default check marks browser references `not-checked`; it cannot report completion with unchecked browser evidence. After successful current runs of `@devkit/example-webext` commands `test:browser`, `test:firefox`, `test:json-actions` and the [opt-in Chromium persistence command](../../examples/webext/PERSISTENCE.md#maintained-proof), run:

```sh
pnpm run conformance:check --browser
```

`conformance:inventory` prints discovered names for review. It does not rewrite the matrix or automatically assign coverage. Move an API from an unmapped group only after linking concrete tests and retaining its remaining host/mode obligations.

`conformance:release` requires browser evidence as well as Vitest results, then rejects every group with remaining gaps. It currently fails deliberately. This is one required completion check, not the complete release policy: packed consumers, native-host/version receipts, unsupported outcomes, type-only contracts and full development/preview/release coverage remain obligations of [Release and conformance contract](https://github.com/dvcol/devkit-extension/issues/16).
