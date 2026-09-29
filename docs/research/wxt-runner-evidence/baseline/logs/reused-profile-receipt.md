# Native WXT Chromium restart observation

The result is incomplete. WXT launched its own Chromium process, the extension reported runtime manifest version `1.0.0`, and clicking the popup's Increment button completed a real runtime message to the background with count `1`.

Changing `manifest.version` to `1.0.1` in `wxt.config.ts` triggered WXT's native `Config changed, restarting server` path. The log shows a second server start and a complete rebuild; the generated manifest has version `1.0.1`. During the native browser reopen, web-ext failed:

```text
Error: CDP connection closed before response to Extensions.loadUnpacked
```

The post-restart runtime manifest and action are unverified. A new built manifest is not evidence that the running extension adopted it. The error occurred in the native asynchronous watcher path and terminated Node before the script's final receipt write. `receipt.json` is therefore explicitly a post-run audit; the previous attempt's top-level receipt was moved to `logs/prior-attempt-top-receipt.json` to prevent stale results being mistaken for this run.

The probe used WXT 0.21.4, web-ext 10.7.0, Vite 8.3.0, Playwright 1.63.0 and its cached Chromium 153.0.8010.12. `chromium.executablePath()` selects the exact cached binary. No browser download was performed. Native WXT and web-ext owned browser creation, extension loading, config watching and restart. The script only attached Playwright and observed/clicked the extension.

WXT still forwards the public `chromiumPort` setting, but web-ext 10.7.0 uses `--remote-debugging-pipe` and no longer reads that setting. The first attempt launched successfully but correctly failed to attach over HTTP. The final probe additionally passed Chromium's public `--remote-debugging-port` argument through WXT `chromiumArgs`; this enabled observation without replacing the native pipe or runner. The original negative observation is retained in `logs/chromium-port-only.log`.

An intermediate test-only mistake called `browser.waitForEvent`, which Playwright's Browser object does not expose. It was corrected to its native disconnected event and `isConnected()` observation. This attempt is retained separately in `logs/driver-api-attempt.log` and is not a WXT defect.

The final run used an explicit owned profile and `keepProfileChanges:true`. A comparison with web-ext's normal fresh temporary profiles was not attempted. Profile reuse, restart timing and concurrent CDP attachment remain possible causes, not established diagnoses. No runtime dependency patch or custom recovery path was added.

After the failed run, the test process had exited. A process audit for this fixture's path found only the audit command itself, with no remaining owned Chromium or helper processes. The fixture and installed dependencies remain available.

## Reproduce

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec node check-managed-restart.mjs > logs/runtime.log 2>&1
```

The script allocates local ports and writes its WXT config before startup, then changes the version while WXT watches it. It resets version `1.0.0` at each run. It uses the native `createServer()` API with the runner enabled, and calls `server.stop()` during normal cleanup. Re-running an unresolved native fatal error may require auditing owned processes afterward.

The current raw run is `logs/runtime.log`; the exact executed script is `check-managed-restart.mjs`. Preserve `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `patches/`, `entrypoints/` and `popup.ts`. The patches affect declarations only and were proved in the separate strict-declaration fixture. Exclude `node_modules/`, `profile/`, `.wxt/` and `.output/` when retaining source evidence.

No maintained repository files changed and no upstream PR was opened. This result does not settle Firefox lifecycle, full extension HMR or renderer cleanup.
