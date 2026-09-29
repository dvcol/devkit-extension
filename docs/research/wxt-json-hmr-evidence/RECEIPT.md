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

This proves the maintained single-provider native JSON panel's Chromium module replacement. It does not establish Firefox renderer HMR, toolbar-popup/DevTools/sidebar lifecycle, background/content replacement, watched production, repeated rapid updates or every asynchronous mount failure. Cross-provider JSON action composition still awaits its separate owner decision. No upstream PR was opened, no root WXT dependency was installed, and no custom reloader was introduced.
