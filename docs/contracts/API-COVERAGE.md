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
| `gaps` | Unfinished evidence or host/mode obligations; any remaining gap blocks the completion check |

The first linked group covers nine declaration factories in the UI-free contribution example. It checks five core declaration tests and the real local-provider integration test. Its node/unit and custom-local-provider/integration results make no claim about native browser or server modes. Other entries remain explicitly unmapped while existing evidence is reconciled. Unmapped does not mean untested.

Vitest produces its normal JSON report through its built-in reporter. The checker requires the exact file and test name to appear once with `passed` status in a successful run. Missing, renamed, skipped, todo, failed or duplicated results cannot satisfy the entry. Example and test files must exist. Test authors still own meaningful assertions; matching a passed name alone cannot assess test quality.

The generated `.conformance/report.json` records every API path, examples, host/mode, test result, native run timestamp and outstanding gap. CI creates it after workspace tests and retains it with the native reports as the `api-conformance` artifact. Turbo also caches the native report as a test output, so cached tests retain their original execution timestamp. Local checks read the latest generated reports; rerun the affected tests after changes rather than treating an old report as fresh execution.

## Commands

Build affected package declarations before inventory checks. For the currently mapped evidence, run:

```sh
pnpm --filter @devkit/core test
pnpm --filter @devkit/example-contribution test
pnpm run conformance:test
pnpm run conformance:check
```

`conformance:inventory` prints discovered names for review. It does not rewrite the matrix or automatically assign coverage. Move an API from an unmapped group only after linking concrete tests and retaining its remaining host/mode obligations.

`conformance:release` applies the same checks and then rejects every group with remaining gaps. It currently fails deliberately. This is one required completion check, not the complete release policy: packed consumers, native-host/version receipts, unsupported outcomes, type-only contracts and full development/preview/release coverage remain obligations of [Release and conformance contract](https://github.com/dvcol/devkit-extension/issues/16).
