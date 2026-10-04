# CDB worker recovery candidate

The maintained real Chromium investigation found that stopping the MV3 worker leaves its extension-owned debugger attachment alive. Fresh native provider restoration then fails when it calls `chrome.debugger.attach` again. This directory retains the small native source candidate and its isolated regression evidence for [Debugger and CDB contract](https://github.com/dvcol/devkit-extension/issues/10). It is not an upstream submission.

`chrome.patch` changes only the native Chrome adapter. Normal attach runs first. Only an exact already-attached error for a persisted target enables a same-extension ownership probe through `Runtime.getIsolateId`. A successful probe permits detach and fresh attach, resetting native domain and child-session state that the new worker no longer tracks. Other attachment failures, probe failure, detach failure and fresh-attach failure propagate. No public API, ownership registry or SDK recovery wrapper is added.

This follows the existing single CDB owner. Chrome command success establishes extension ownership, not exclusion between independently created managers inside that extension. `getTargets().attached` is not used as ownership proof.

## Scope and results

The [maintained tests](../../../examples/debugger/tests/chrome-recovery.test.ts) run the real native provider, recovery loop, tab-scope manager and selected-tab publisher. Chrome I/O and the authenticated provider-channel boundary are fixtures. These unit checks establish branch behavior and publication ordering; they do not themselves prove worker termination, authentication or browser attachment recovery. The maintained real-browser suite supplies those separate checks.

| Variant | Passed | Failed | Receipt |
| --- | ---: | ---: | --- |
| Original released native source | 6 | 4 | [Baseline](./baseline-tests.json) |
| Same native source with candidate | 10 | 0 | [Candidate](./candidate-tests.json) |
| Installed patched public package | 10 | 0 | [Installed](./installed-tests.json) |

The four original-source failures concern ownership-probe rejection, successful reset, detach failure and fresh-attach failure. The original adapter never reaches those steps because its first attach rejects. Controls cover normal attach, missing persisted identity, permission/protocol errors, another tab's conflict message and a non-Error rejection.

The affected debugger package also passed strict TypeScript, type-aware Oxlint and its 21 Vitest cases. The candidate source passed TypeScript 7 with `skipLibCheck: false`. No full upstream repository gate was run for this bounded candidate.

## Replay

From the workspace root, use a readable native CDB checkout whose extension runtime sources match the installed 0.3.0 source maps:

```sh
node docs/probes/cdb-worker-recovery/prepare.mjs /path/to/chrome-debugger-bridge
pnpm exec vitest run --config docs/probes/cdb-worker-recovery/.verification/vitest.config.ts
pnpm exec tsc --noEmit --project docs/probes/cdb-worker-recovery/.verification/tsconfig.json
```

Add `--baseline` to preparation for the expected failing original source. Add `--installed` instead to run the same maintained cases through the installed public package with no runtime alias. Preparation writes only the ignored `.verification` directory and `source-receipt.json`; it does not alter the readable checkout or installed packages. Candidate runs alias only `@dvcol/cdb-extension/chrome` to the copied, patched native source. The test implementation remains in the maintained example.

The installed-package regression also runs normally with:

```sh
pnpm --filter @devkit/example-debugger exec vitest run tests/chrome-recovery.test.ts
pnpm --filter @devkit/example-debugger typecheck
pnpm --filter @devkit/example-debugger lint
```

## Provenance

Preparation verifies all 18 extension runtime sources present in released maps against the readable checkout. This establishes source equivalence only, not equivalence of the entire checkout or its package version. Three additional source files provide declarations/exports in the copied source tree. [Verification receipt](./source-receipt.json).

| Artifact | SHA-256 |
| --- | --- |
| Original `src/chrome.ts` | `878882c22596ac776aa948b5fcac9140cfa57458d02202f573962c8d412e6b6b` |
| Candidate `src/chrome.ts` | `ce773928b658378f9a39fcaf389b0337902fecd1dd469799f7795f06f33e8c81` |
| Tested installed `dist/chrome.js` | `8c2c6cbeab1e76cd792594fa0a70a7a1f8fe9900713725b3704ebfc0ea29ca60` |

The original source path is `packages/extension/src/chrome.ts` in `dvcol/chrome-debugger-bridge`. The installed package is `@dvcol/cdb-extension@0.3.0`; its emitted patch is maintained separately in the workspace dependency policy. Test records contain no authentication credentials.

## Current native handoff, 2026-10-04

The same production candidate applies to current upstream `4053273d`, with 14 additions and 2 removals in one file. [Native test patch](./native-tests.patch) places the ten regressions in the native extension package and consolidates Chrome/connection setup into one test helper. It imports only native CDB contracts and source. There is no SDK code in the proposed upstream change.

Fresh scoped frozen installation uses native pnpm 11.25.0 without dependency-policy, manifest or lockfile changes. Original source with both independent regression sets has six failures and 36 passing controls; the worker cases account for four failures. With both the worker and detached-child cleanup candidates applied, all 106 native extension cases pass. Changed-file native lint, native source TypeScript 5.9.3 with unchanged composite configuration, focused regression types and extension build pass. [Validation](./native-validation.json), [exact source type receipt](./native-source-types.json), [baseline log](./native-baseline.log), [package test log](./native-extension-tests.log).

The retained [focused test project](./native-test-types.json) contains the actual temporary paths used during validation; it is evidence rather than a directly portable checkout configuration. For replay in a clean native checkout, apply `chrome.patch` and `native-tests.patch`, run the extension package tests and source typecheck, and lint its changed source/test files. Source-only upstream typechecking excludes tests; the focused project adds just these regressions using the installed native Node and Chrome ambient types.

An initial independent copy labeled candidate actually contained baseline source. The corrected cold check verifies both final source hashes before and after compilation. Earlier missing-global diagnostics did not reproduce in that exact candidate or in the baseline; their historical cause remains unknown. No production compiler options or declarations were changed to hide them.

The [prepared upstream draft](./upstream-draft.md) includes native reproduction and ownership limits. Publication needs owner approval. The [detached-child candidate](../cdb-detached-child-demand/README.md) remains a separate small fix, so each can be reviewed and committed independently. These readiness checks do not claim a new browser run or full upstream repository gate.
