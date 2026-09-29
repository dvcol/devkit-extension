# CDB subscription activation evidence

September 29, 2026 investigation for [Debugger and CDB contract](https://github.com/dvcol/devkit-extension/issues/10). See the [research report](../../research/cdb-subscription-activation.md) for the mechanism, ownership and limitations. No upstream PR is open.

## Native correction

- `broker.patch`: reviewed upstream source correction, 14 added / 5 removed lines.
- `tests.patch`: eight focused core regressions.
- `baseline.log`: seven failures and one pass before the source correction.
- `candidate.log` and `affected-tests.log`: eight focused and 80 affected tests pass afterward.
- `lint.log`, `typecheck.log`, `typecheck-subscription.json`, `build.log`: narrow native validation. The probe typecheck names its original disposable checkout; adjust that path to reproduce. Test formatting was normalized after the baseline run.
- `installed-baseline.log`: the maintained debugger regression fails against unpatched installed 0.3.0. It now passes in the maintained example against the pnpm patch.
- `upstream-draft.md`: prepared description, pending owner approval.

Apply both source patches to the matching CDB broker checkout. The source candidate's manifest is 0.2.0, but its broker base matches the released 0.3.0 broker source exactly. This does not establish whole-checkout equivalence. The maintained workspace patch changes the actual 0.3.0 emitted module separately.

## Real browsers

`baseline-browser/` retains the exact original scripts and receipt. It verifies the controlled event-loss ordering against unpatched CDB 0.3.0. Its `passed` field means the bug reproduction assertions passed, not that subscription activation was correct.

`installed/` retains the final scripts and receipt using the installed patched CDB 0.3.0. The runner additionally verifies body read and fulfillment before cleanup. Its fixture body marker remains `server:selected:candidate` because the fixture was reused; the dependency evidence and bundle inputs prove that all six bundled core modules resolve to the installed patched package, with no source aliases.

The final patch SHA-256 is `4c884d928efbd1c3c72f51e95e01cd51abef4285ddc314a94f0d624b08638c5c`. The installed broker SHA-256 is `c66269d4ce2e37cfe00fae70d7249d9bcaaa9b88e466b5dfb421a631b16badd0`. Both scenarios passed on Chromium 153.0.8010.12. The full browser receipts are compact JSON with all observed values preserved; no snapshots were omitted. `SHA256SUMS` covers the archived source, receipts and validation artifacts.

To replay the installed proof, copy `installed/` into a disposable directory and link its `node_modules` to the maintained debugger example's installed dependencies. Adjust the recorded repository path in `build.mjs` and `inspect.mjs` if needed. Run `node inspect.mjs`, `node build.mjs`, then `node run.mjs` using the repository's installed Playwright Chromium. The runner owns its loopback server, browser and temporary profile. Generated bundles and dependency directories are omitted.

The baseline runner requires an independently installed unpatched 0.3.0 graph. Running it against the current workspace patch correctly fails its expected-event-loss assertion. Do not remove the workspace patch to reproduce a historical baseline in place.

These frozen research scripts are outside maintained TypeScript/Oxlint gates. The maintained package regression and native example remain the CI guard. Controlled ordering is proved; natural race frequency, in-flight body reads, child sessions, competing domain demand and failed native teardown are not.
