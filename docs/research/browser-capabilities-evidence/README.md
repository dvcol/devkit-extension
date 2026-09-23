# Browser capability evidence

Collected on 2026-09-22 in isolated processes on macOS 26.6.2 build25G83, Node26.9.0. Current-stable versions were selected from official release metadata, not cached or installed browsers. Each experiment used a fresh owned profile and loopback fixture. No existing browser or native computer controls were used.

## Final evidence

| File | Scope |
| --- | --- |
| `stable-channel-metadata.json` | Official CfT stable153.0.8010.52 and Firefox156.0.1 metadata with retrieval time and source URLs. |
| `chromium-native-stable.json` | Fifteen assertions in eight groups from unchanged `../browser-capabilities-experiment.mjs`, rerun using Playwright1.63.0 and stable CfT153.0.8010.52. |
| `chromium-coexistence.mjs` / `.json` | Four fresh headed-browser cases. Node controls browser session, own extension document and briefly native frontend document. No controller autoattach or direct session on the inspected fixture. Native frontend existing connection evaluates54; extension connection evaluates42 after both attach. Both Fetch cases return transformed body; no observed detach. |
| `firefox-filtering.mjs` / `.json` | Two web-ext10.7.0 cases on Firefox156.0.1. MAIN/isolated boundaries, parser timing, messaging, native debugger absence, buffered text/HTML/split-UTF8 filtering, absent-filter-permission rejection. |
| `oxlint.json` | Scoped correctness and suspicious-rule configuration used for the new probe scripts; no repository-wide lint run. |

The Chromium frontend check imports its bundled internal `core/sdk/sdk.js`. This makes the experiment repeatable on the recorded build but is not a supported application API or a future SDK dependency. `Target.openDevTools` and `Target.getDevToolsTarget` are experimental browser CDP commands. The controller cannot infer future compatibility merely from a successful run here.

The Firefox filter buffers all decoded input until `onstop`, writes once and closes. Its three delivered chunks include a split multibyte character; this proves decoding and whole-response transformation only. The absent permission case does not represent actual user denial or host-permission revocation. Each case waits for page, isolated, and all terminal filter reports before assertions.

## Retained failed or superseded runs

- `chromium-preflight-failure.json`: localhost-polling initialization timeout. Diagnostic fetch on the owned worker also timed out. No coexistence claim.
- `chromium-intermediate-failure.json`: extension control document introduced; response-pause timeout. The early “observed” case had not proved loaded fixture or native frontend readiness and is superseded.
- `chromium-headed-navigation-failure.json` and `chromium-headless-navigation-failure.json`: loaded-document gate failed, with zero fixture HTTP requests.
- `chromium-before-readiness.json`: four observed command/response cases after mock-keychain flags; native frontend readiness and both-client command checks were added in the final run. Superseded by `chromium-coexistence.json`.
- `firefox-preflight-failure.json`: no webRequest filter events from initial port-specific matching/readiness setup; native timing/messaging observations existed, but filtering assertions failed. Superseded by corrected final fixture.
- A browser-session `Extensions.setStorageItems` attempt returned `{"code":-32600,"message":"No associated browser context."}`. That intermediate full JSON was overwritten during diagnosis; this exact error was preserved in the tool transcript and is recorded here as a controller limitation, not browser feature evidence.

The Chromium navigation comparison changed only the use of `--password-store=basic` and `--use-mock-keychain` in the isolated browser's launch. With those flags, navigation and all later assertions passed. This does not identify an OS dialog or prove a keychain root cause. Both flags are also present in Playwright's macOS launch configuration. No security permission prompt was clicked or bypassed through native computer control.

## Reproduction

Use disposable checkout storage, the recorded public browser binaries, and Node26.9.0. Dependencies are external research tools, not SDK package dependencies. The original native fixture needs Playwright1.63.0; the Firefox fixture needs web-ext10.7.0. Supply absolute executable/module paths:

```sh
BROWSER_RESEARCH_CHROMIUM='/absolute/path/to/Google Chrome for Testing' \
node docs/research/browser-capabilities-evidence/chromium-coexistence.mjs

BROWSER_RESEARCH_FIREFOX='/absolute/path/to/firefox' \
BROWSER_RESEARCH_WEB_EXT='/absolute/path/to/node_modules/web-ext/index.js' \
node docs/research/browser-capabilities-evidence/firefox-filtering.mjs

BROWSER_RESEARCH_CHROMIUM='/absolute/path/to/Google Chrome for Testing' \
BROWSER_RESEARCH_PLAYWRIGHT='/absolute/path/to/node_modules/playwright/index.mjs' \
node docs/research/browser-capabilities-experiment.mjs
```

The two new scripts write results to `.browser-v2/results` by default, overridable with `BROWSER_RESEARCH_OUTPUT`. They remove their temporary generated extension/profile directories and close owned browsers and servers in cleanup. The original fixture leaves `.browser-experiment` for inspection; remove it after preserving its result. None of these generated directories, browser binaries or dependency trees is part of this evidence bundle.

Validation used `node --check` for both new MJS scripts and the unchanged native fixture, plus Oxlint1.85.0 against only the two new scripts with `--config docs/research/browser-capabilities-evidence/oxlint.json --disable-nested-config --threads 1 --deny-warnings`. Browser-generated JavaScript was executed by the recorded real-browser runs. These are JavaScript research probes; no static TypeScript API-contract validation or finished SDK typing is claimed. A separate JSON integrity check confirms all final outcomes, versions and the two-client values.

Retained JSON replaces only the temporary worktree prefix with `<research-worktree>`. Target IDs, loopback ports, browser versions, event payloads, errors and results are unchanged. `SHA256SUMS` records the retained files. Old Chrome151 evidence remains in the parent research directory as explicitly historical evidence.
