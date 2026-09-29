# CDB-owned response transform probe

Frozen source and receipts for the September 29, 2026 experiment documented in [the research report](../../research/cdb-response-transform.md). This is a bounded Chromium experiment, not a maintained transform contribution API.

The probe used the installed `@dvcol/cdb@0.3.0` and `@dvcol/cdb-extension@0.3.0` through a `node_modules` symlink to `examples/debugger/node_modules`. `build.mjs` resolves the repository's installed Vite/Rolldown through the exact recorded checkout path. It rejects Node builtins and external output imports. Generated extension bundles and dependency directories are intentionally omitted.

To reproduce, copy these files to a disposable directory, link the maintained debugger example's installed `node_modules`, and adjust the checkout path in the copied build script if necessary. Run `node build.mjs`, then `node run.mjs`. The runner launches an owned temporary Playwright Chromium profile and a loopback HTTP fixture; it requires the browser installed by the repository's existing setup. It writes `receipt.json` and closes its browser, server and temporary profile.

The final `receipt.json` passed all assertions on Chromium 153.0.8010.12. `initial-launch-failure.json` records a sandbox loopback bind failure. `first-browser-receipt.json` records a harness assertion that incorrectly expected an unencoded response body despite native `base64Encoded: true`. The corrected runner decodes the native value; the extension code was unchanged.

`SHA256SUMS` preserves the exact executed source and receipt bytes. These scratch scripts are archived research, excluded from maintained TypeScript/Oxlint gates. Their successful browser execution does not imply those gates or complete transform lifecycle coverage.
