# Second-pass toolchain evidence

Captured on 2026-09-22. Start with [the report](../toolchain-reload.md) and [reviewed-results.json](./reviewed-results.json). The review overrides ambiguous success-looking statuses in raw browser output.

The raw browser files preserve observations, including failures. `reload-results.json` covers WXT and custom development. `reload-results-followup.json` covers the bounded WXT fallback sequence. `production-results.json` covers compiled packages. A zero exit from the browser observation runner means cases completed; it does not certify every step.

`probe/` contains final authored sources, pinned manifests and a coherent workspace lockfile. `standalone-consumer/` is outside that workspace and consumes the packed root export. Rebuild and pack the SDK before installing that consumer. Dependencies, browser binaries/profiles, caches, generated bundles and tarballs are excluded. `manifests/` and `artifact-inspection.json` retain generated-output evidence.

Two deliberate negative-control groups are separate from unresolved compatibility failures:

- `turbo-negative-test.log` and `turbo-negative-inventory.log` intentionally fail with exit 1. The latter removes one item from a synthetic declared-feature array; it does not discover API/example/host coverage.
- `boundary-results.json` accepts the portable sample and rejects direct/transitive `node:fs` plus one exact synthetic renderer path. It is a demonstrated resolver enforcement mechanism, not coverage of every real package graph.
- `wxt-types-with-chrome.log` and `wxt-types-without-chrome.log` are unresolved third-party declaration failures. They are not successful negative tests.

`final-validation.json` records strict checks of authored sources, custom packaging and portable contracts. `tsconfig.check.json` skips third-party declaration checking for the WXT adapter/runner only. `tsconfig.custom.json`, the SDK portable config and standalone consumer do not skip library checks. No SDK-wide exemption was selected. WXT's own generated configuration also sets `skipLibCheck`, but the audit retains the complete-check failure instead of treating that setting as proof of declaration compatibility.

Oxlint runs on explicit authored file paths. Generated bundles and negative-reproduction files are excluded from that positive lint command. The research scripts deliberately serialize changes to shared fixture files and browsers, so their configuration disables `no-await-in-loop`. The two HTML entry modules intentionally import their application for side effects, so their configuration disables `no-unassigned-import`. No coverage-ignore pragma or production test-only injection was added.

The final SDK tarball includes `src` alongside `dist`. `declaration-map-results.json` verifies both emitted declaration maps reference files present in that tarball. The first pass lacked these source targets; `packed-sdk-final.log` and final standalone logs supersede that packaging result. Root ESM/types consumption was tested; other export conditions were not.

Private absolute paths and ANSI escapes were normalized. Public registry URLs, system paths, localhost addresses, timestamps and fixture extension IDs remain. `file-manifest.json` records byte counts and SHA256 values. The raw `orchestration-results.json` describes its original pass; the `*-final.log` files document the later corrected tarball.

Turbo used its default shared-worktree cache during the original commands. That research-owned cache was relocated from the main checkout by the coordinator. Reproduction commands must add `--cache-dir=.cache/turbo` from `probe/` so all new cache output remains isolated.

Retained CLI logs also trim trailing horizontal whitespace from aligned tool output and surplus terminal blank lines. Commands, diagnostics, statuses and raw JSON observations are unchanged.
