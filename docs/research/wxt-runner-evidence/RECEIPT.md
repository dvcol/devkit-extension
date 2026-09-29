# Retained native runner experiment

Both bounded Chromium checks passed with a temporary WXT runtime patch. The prior failed native-default test and this passing config-change test use byte-identical scripts; `script-identity.json` records that comparison. Failed observations remain unchanged at `/private/tmp/devkit-wxt-managed-chromium-DnfUU2`.

The runtime patch retains the runner that opened the active browser inside `createServerInternal`. `stop()` and `restartBrowser()` close that retained runner. Each native opening captures the currently configured runner before calling `openBrowser()`. The runtime-only diff is `runner-only.patch`: seven added and four removed lines in `dist/core/create-server.mjs`. No new watcher, transport, retry or reload policy was added.

The actual pnpm patch is `patches/wxt@0.21.4.patch`, which combines that runtime fix with the previously validated declaration-template correction. The browser declaration patch is unchanged. The lockfile pins the resulting patch hashes.

## Source-change test

Run `f89b88ea-e4c5-4f30-9c28-216a3e564db6` used the native fresh-profile runner, changed `wxt.config.ts` manifest version from `1.0.0` to `1.0.1`, and observed:

- The original browser disconnected 76 ms after the source change.
- The replacement had a different CDP browser endpoint.
- The same extension ID reported actual runtime manifest version `1.0.1`.
- A real popup button sent a native background message and returned count `1`, a fresh request ID and a new background generation.
- Native `server.stop()` closed the replacement; no fallback browser-close call was needed.

Evidence: `check-managed-restart.mjs`, `receipt.json`, `logs/runtime.log`.

## Public browser restart and shutdown

Run `7088650f-ee6d-4a83-8366-24c0471ad3c5` separately invoked public `server.restartBrowser()` without editing source. The original browser closed, a replacement with a different CDP endpoint completed the same native action at manifest version `1.0.0`, and public `server.stop()` closed that replacement. It asserted `initialBrowserClosed:true` and `finalStopClosedBrowser:true`.

Evidence: `check-browser-restart.mjs`, `restart-browser-receipt.json`, `logs/restart-browser.log`. This second receipt does not overwrite the unchanged source-change test.

After both runs, the process audit found no owned browser for either debugging port or fixture path. `logs/final-process-audit.log` contains only the audit command and matcher. Both test processes exited zero.

## Reproduce

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec node check-managed-restart.mjs > logs/runtime.log 2>&1
pnpm exec node check-browser-restart.mjs > logs/restart-browser.log 2>&1
```

WXT 0.21.4, web-ext 10.7.0, Vite 8.3.0, Playwright 1.63.0 and cached Chromium 153.0.8010.12 were used. No browser was downloaded. WXT's native runner remains enabled. The native `chromiumArgs` debugging-port argument exists only to let Playwright observe the browser; web-ext retains its native pipe and owns loading/restart.

The experiment supports the runner-ownership explanation for the measured config-change failure. It does not establish Firefox behavior, retained-profile recovery, content updates, HTML/renderer HMR, production watch, or upstream acceptance. No maintained repository files changed and no upstream PR was opened.

Retain this receipt, both test scripts and JSON receipts, `script-identity.json`, `runner-only.patch`, `logs/`, `patches/`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `entrypoints/` and `popup.ts`. Exclude generated output, installed dependencies and `patch-wxt/` staging files. All fixtures remain available on disk; no further scenarios were run.
