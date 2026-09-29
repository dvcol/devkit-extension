# Native JSON panel module replacement

The maintained `examples/webext` source passes a live Chromium module-replacement check through WXT's native runner. This is standalone adoption evidence for #13. WXT is not a maintained workspace dependency, and the normal Vite production commands do not yet implement extension development HMR.

## Implementation

`background-entry.ts` starts the exported background implementation synchronously. Importing the implementation no longer creates a runtime, so WXT can inspect its entrypoint without executing extension code during configuration. Native RPC, state, sender admission and catalog behavior are unchanged. No lint exception is needed for synchronous event registration.

`panel.ts` accepts native Vite HMR and registers a disposal callback. Disposal aborts DOM listeners, closes the old connection and releases its renderer/router/subscriptions. Delayed results are ignored by the disposed UI. The same lifetime rule guards server and page-discovery controls. A renderer that finishes mounting after disposal is immediately released. Manual disconnect still shows pending-call errors. Remote work is neither cancelled nor replayed.

## Observed behavior

The check imports the actual maintained background and panel modules. Its one source edit appends a DOM marker to `panel.ts`; `finally` restores the exact original contents. WXT owns the browser process and native update channel. Playwright attaches only for observation and UI interaction.

- Two extension documents initially show the native JSON counter at zero.
- The rendered button updates native shared state in both documents.
- A pending backend action is started before module replacement.
- The original document `performance.timeOrigin` and background identity remain unchanged.
- Both old native Ports close; precisely two new Ports remain connected.
- The original routed button and replacement each have exactly one native DOM click listener, measured through CDP.
- The native renderer mounts once per document and retains the counter value.
- Post-update routed and rendered buttons increment the counter once each.
- Releasing the old backend action changes execution counts to one started / one completed. The replacement result remains unchanged over a further 750 ms observation window.
- There are no captured page errors or warning/error console messages in the successful run.
- Native WXT stop closes its browser; source restoration is byte-exact.

The successful `receipt.json` records the panel SHA-256, identities, Port lifetimes and actual manifest. `logs/run.log` is the live run, and `json-hmr.png` shows the final UI. A fresh temporary directory installed the retained frozen lockfile before this run, without symlinking another fixture's dependencies.

The maintained production checks also passed after the implementation changes: strict Oxlint, TypeScript, formatting, both manifest/bundle tests, Chromium's 24 scenarios and Firefox's 18 groups. Their browser output is retained in `logs/production-*.log`. The latter does not claim global Firefox page-error capture.

## Reproduce

First install/build the maintained repository's affected dependency graph with its normal pinned patches. Copy this evidence directory to a temporary directory, then run:

```sh
pnpm install --frozen-lockfile --ignore-scripts
DEVKIT_REPOSITORY=/absolute/path/to/devkit-extension pnpm exec node check-json-hmr.mjs
```

The script generates its WXT entrypoints and configuration using `DEVKIT_REPOSITORY`. Do not concurrently edit `examples/webext/src/panel.ts` during the check because the script owns and restores that one temporary change. A cached Playwright Chromium is required. Used versions: WXT 0.21.4, Vite 8.3.0, web-ext 10.7.0, Playwright 1.63.0, Chromium 153.0.8010.12, pnpm 12.5.1 and Node 26.9.0.

The fixture retains the previously proven declaration corrections and native runner-ownership patch. No additional dependency patch was needed. Its development origin is explicitly `http://127.0.0.1` to match the existing loopback connection CSP. WXT's native HTML rewriting takes an absolute filesystem entrypoint path; pre-prefixing it with Vite's `/@fs/` causes a duplicated path. Both setup mistakes were corrected before the recorded successful run.

## Limits

This proves the maintained single-provider native JSON panel's Chromium module replacement. The separate Firefox check and Chromium background follow-up below extend that evidence. Toolbar-popup/DevTools/sidebar lifecycle, content replacement, watched production, repeated rapid updates and every asynchronous mount failure remain unproved. Cross-provider JSON action composition still awaits its separate owner decision. No upstream PR was opened, no root WXT dependency was installed, and no custom reloader was introduced.

## Follow-up: native HTML and background reload

`check-native-reloads.mjs` uses the same fixture dependencies and maintained modules, then edits the generated HTML heading. WXT's native HTML reload updates both documents, changes the observed time origin and retains the same live background identity and counter value.

The first background-entrypoint run failed. Native reload closed the old worker and both extension pages, then the same extension URL returned `ERR_BLOCKED_BY_CLIENT` across 21 attempts in ten seconds. `reload-default-receipt.json` and `logs/reload-default.log` retain that failed observation with `passed: false`; `reload-default-script.mjs` is its exact script.

A minimal generic background fixture isolated the cause from the maintained SDK. Its actual Chrome Developer mode switch was off. Public CDP listed the extension as enabled before native reload and disabled afterward; the generated manifest was byte-identical. Enabling the normal Developer mode toggle in that disposable profile made the same native reload path keep the extension enabled and execute the changed background initializer. This uses the ordinary unpacked-development setting, without disabling a browser security feature or adding runtime code. The comparison, exact scripts and Chromium 153 source references are retained under `chromium-developer-mode/`. Its source diagnosis was written before the live comparison and labels that earlier finding as a hypothesis.

The maintained follow-up then passed with Developer mode enabled. Panel HMR and HTML reload retain background state. Changing the background entrypoint closes both old pages and the old worker; opening a fresh panel connects to a different provider incarnation. Ephemeral counter/execution state starts at zero, the old pending action is not replayed, and a rendered action executes against the new worker. The browser process survives. No SDK reconnect loop, worker supervisor or background-state restoration was added. `reload-receipt.json`, `logs/reload.log` and `native-reloads.png` contain the successful run. Native stop closes the browser and source restoration is exact.

Replay from the same standalone fixture:

```sh
PROOF_ENABLE_DEVELOPER_MODE=1 DEVKIT_REPOSITORY=/absolute/path/to/devkit-extension pnpm exec node check-native-reloads.mjs
```

The environment option tells the test to enable Developer mode through the owned browser's normal extension-management UI. It is not a maintained extension option. Without it, the fresh-profile failure remains reproducible in the measured environment. web-ext already writes a Developer mode preference, but Chrome protects that preference; the normal persistent-profile setup below avoids depending on a launcher-created value.

To reproduce the generic comparison, install this parent fixture's frozen dependencies, change into `chromium-developer-mode/`, then run `pnpm exec node check-background-only.mjs` with and without `PROOF_ENABLE_DEVELOPER_MODE=1`. Preserve each resulting receipt before the next run. This minimal test does not import or edit the maintained repository.

## Native dedicated-profile setup

Chrome 153 marks Developer mode as an [integrity-protected atomic preference with enforcement on load](https://github.com/chromium/chromium/blob/153.0.8010.12/chrome/browser/prefs/chrome_pref_service_factory.cc#L176). Its [validation can reset untrusted values](https://github.com/chromium/chromium/blob/153.0.8010.12/services/preferences/tracked/tracked_preference_helper.cc#L31). The normal browser toggle [writes through Chrome's PrefService](https://github.com/chromium/chromium/blob/153.0.8010.12/chrome/browser/extensions/extension_util.cc#L334). These sources explain why a launcher-written JSON value is not a reliable setup contract. The exact internal validation result was not captured, so attributing the observed reset to this path is a source-supported inference.

WXT's public `chromiumProfile` and `keepProfileChanges: true` options provide a [dedicated persistent profile](https://wxt.dev/guide/essentials/config/browser-startup#persist-data). `check-profile-retention.mjs` creates a temporary profile, enables Developer mode through its normal UI, verifies native background reload, restarts the browser through public WXT `restartBrowser()`, and verifies another background reload. The final check passes: Developer mode remains enabled after restart, the changed background initializers return `101` and `201` with different execution generations, native stop succeeds and the owned profile is removed.

An initial immediate restart lost the newly toggled setting. The retained passing test first waits for Chrome's own `Secure Preferences` file to contain its saved boolean, then restarts. That read-only wait is test observation, not a production hook or custom persistence policy. `immediate-restart-receipt.json` preserves the failure; `profile-receipt.json` and `logs/profile-retention.log` record the passing replay. No preference hashes or browser policy controls were modified.

From `chromium-developer-mode/`, using the parent fixture's frozen dependencies:

```sh
PROOF_ENABLE_DEVELOPER_MODE=1 pnpm exec node check-profile-retention.mjs
```

The supported setup candidate is therefore one-time normal Developer mode setup in a dedicated native profile, after Chrome saves the setting. Automatic setup of a brand-new disposable profile is not established. The test does not read or alter the user's regular browser profile, and these remain research fixtures rather than maintained development commands.
