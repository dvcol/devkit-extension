# Native WXT Chromium restart observation

The result remains incomplete. Both attempts proved initial native launch, actual extension runtime manifest `1.0.0`, and a UI-triggered `runtime.sendMessage` background increment returning count `1`. Changing `manifest.version` to `1.0.1` in `wxt.config.ts` triggered WXT's native restart and a rebuilt manifest. Neither attempt established the post-restart live manifest or action.

## Explicit reused profile

The first causal restart attempt used an owned Chromium profile with `keepProfileChanges:true`. WXT logged a second server start and completed the build, then web-ext failed:

```text
Error: CDP connection closed before response to Extensions.loadUnpacked
```

Evidence: `logs/reused-profile.log`, `logs/reused-profile-receipt.json`, `logs/reused-profile-script.mjs`, and `logs/reused-profile-receipt.md`. The native asynchronous failure terminated Node before the script's final receipt write; that receipt is explicitly a post-run audit, not a successful test result.

## Native fresh profiles

The final run omitted `chromiumProfile` and `keepProfileChanges`, leaving web-ext's default temporary-profile behavior. WXT logged a second server start, complete build and successful second browser open. However, the original Playwright browser remained connected for all 30 seconds after the config change. The assertion that the original browser had closed failed; subsequent live manifest/action checks were not reached.

The exact run ID is `88ca58c0-9d45-4e89-b849-0e0a3f1d54ef`. `receipt.json` contains the actual initial manifest/action response, browser version, endpoint, lifecycle timestamps, failure and successful cleanup results. `logs/runtime.log` is the final raw run, and `check-managed-restart.mjs` is its exact script. The test writes an initial receipt before startup and another before mutation, so fatal errors cannot leave a previous run's receipt at the primary path.

## Native ownership problem suggested by source

Local WXT 0.21.4 source explains the observed failure without requiring an SDK reload engine:

1. `dist/core/utils/create-file-reloader.mjs` calls `wxt.reloadConfig()` before `server.restart()`.
2. `dist/core/wxt.mjs` replaces `wxt.config` using `resolveConfig`.
3. `dist/core/resolve-config.mjs` creates a fresh `createWebExtRunner()` on each resolution.
4. `dist/core/create-server.mjs` implements stop through `wxt.config.runner.closeBrowser()`, which now refers to the new runner closure.
5. `dist/core/runners/web-ext.mjs` stores the actual running web-ext instance in that closure's local `runner` variable.

The old runner reference is therefore lost before stop can close its browser. This is a strong source-based explanation for the original browser surviving. Reusing the same profile then plausibly prevents the next Chromium instance from acquiring it, while fresh profiles permit another browser. No dependency runtime patch was made and this explanation has not been confirmed by a corrected upstream build.

## Driver and cleanup

Versions: WXT 0.21.4, web-ext 10.7.0, Vite 8.3.0, Playwright 1.63.0 and cached Chromium 153.0.8010.12. The script uses `chromium.executablePath()` and downloaded no browser. WXT/web-ext own launch, extension loading, watching and restart; Playwright only attaches, reads and clicks.

WXT still forwards `chromiumPort`, but web-ext 10.7.0 uses `--remote-debugging-pipe` and ignores that setting. The observer additionally uses Chromium's public `--remote-debugging-port` through WXT `chromiumArgs`. The first attach-only failure is retained in `logs/chromium-port-only.log`; an intermediate corrected Playwright API mistake is in `logs/driver-api-attempt.log`. Neither is counted as a reload result.

After the final timeout, native `server.stop()` succeeded and the script explicitly closed the still-connected original browser. Both cleanup promises fulfilled. `logs/final-process-audit.log` contains only the audit shell and matcher, with no owned browser/process for either final debug port or fixture path. No further adapter or workaround was added.

## Reproduce

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec node check-managed-restart.mjs > logs/runtime.log 2>&1
```

The script allocates local ports and resets the starting version before each run. Retain `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `patches/`, `entrypoints/`, `popup.ts`, `check-managed-restart.mjs`, this receipt, `receipt.json`, and `logs/`. Exclude `node_modules/`, `profile/`, `.wxt/` and `.output/` from source evidence.

No maintained repository files changed or upstream PR was opened. The separate declaration fixture remains unchanged. Full maintained-renderer HMR, Firefox lifecycle, post-restart runtime manifest and post-restart action remain unverified.
