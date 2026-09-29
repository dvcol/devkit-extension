# WXT-managed Firefox lifecycle proof

The patched native WXT runner passed this bounded check on Firefox 156.0.1 with geckodriver 0.37.1. Run e3270cfb-f1db-4843-a42f-ebb327df3ee6 is retained in `receipt.json`; `logs/runtime.log` is the raw output.

- WXT launched Firefox in its own fresh temporary profile. Selenium attached through documented geckodriver `--connect-existing --marionette-port`; it did not launch or install the extension.
- The initial extension reported runtime manifest `1.0.0`, and a popup button completed a native background message with count `1`.
- Editing `wxt.config.ts` to manifest version `1.0.1` closed the old Firefox PID. A replacement PID reported actual runtime manifest `1.0.1` and completed another UI-triggered increment with a new background generation.
- Native `server.stop()` closed the replacement. Every cleanup fulfilled, and the final owned-process list is empty.

The same retained-runner patch previously checked in Chromium is unchanged here. `runner-only.patch` contains its runtime-only diff. `patches/wxt@0.21.4.patch` combines it with the previously proved declaration-template correction; `patches/@wxt-dev__browser@0.3.0.patch` is declaration-only.

## Native identity and driver access

Each fresh Firefox profile assigns its own internal extension UUID. The script reads only the declared extension ID's mapping from that owned profile's native `prefs.js`, using the profile path and PID returned in WebDriver capabilities. It does not force UUIDs or reuse a user profile.

The earlier fixed-UUID fixture supplied a JSON-valued preference that web-ext wrote with unescaped nested quotes. Navigation to that assumed UUID stayed at `about:blank`. Those failures and their exact scripts remain in `logs/`. Removing that override and reading Firefox's actual mapping resolved navigation. An initial Selenium logging-API mistake and the original navigation timeout are also retained, separately from passing evidence.

The isolated browser uses Firefox's required native extension-automation permission and loopback Marionette attachment. No CSP, origin, certificate, authentication or content-security check was disabled. The driver uses native nonblocking navigation and explicitly waits for the extension's own runtime-manifest DOM value. [Mozilla's geckodriver flags](https://firefox-source-docs.mozilla.org/testing/geckodriver/Flags.html) document attachment and privileged automation flags.

## Standalone replay

Run from this fixture directory:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec node check-managed-firefox.mjs > logs/runtime.log 2>&1
pnpm exec tsc --noEmit -p tsconfig.json
```

Frozen installation, the live check and strict TS7 compilation passed. The three TypeScript fixture inputs also passed the repository's strict type-aware Oxlint configuration through the host toolchain. Script syntax was checked with `node --check`.

The script explicitly selects Firefox 156.0.1 at `/Applications/Firefox.app/Contents/MacOS/firefox` and geckodriver 0.37.1 at the cached path declared near its top. Those binaries must already exist; no browser or driver download was performed. Adjust those two constants for equivalent pinned binaries on another machine. The package lock pins WXT 0.21.4, web-ext 10.7.0, Vite 8.3.0, Selenium 4.49.0 and both patch hashes.

Geckodriver logs an error closing its browser connection during observer shutdown because WXT has already killed its browser. The test separately verifies those PIDs are gone; all observer service cleanup fulfilled.

Retain `RECEIPT.md`, `receipt.json`, `check-managed-firefox.mjs`, `runner-only.patch`, `logs/`, `patches/`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `wxt.config.ts`, `tsconfig.json`, `entrypoints/` and `popup.ts`. Exclude `node_modules/`, `.wxt/` and `.output/` from source evidence. No maintained repository files changed or upstream PR was opened.

This verifies the patched native Firefox config-change path. It does not establish an unpatched Firefox regression, Firefox's public restartBrowser method separately, content-script updates, renderer HMR, production watch, persistence or full SDK conformance.
