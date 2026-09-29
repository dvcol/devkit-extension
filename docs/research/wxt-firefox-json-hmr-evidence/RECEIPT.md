# Firefox native JSON panel HMR

The maintained `examples/webext` JSON panel passed native WXT module replacement in Firefox 156.0.1. The final exact-source run is `d0ed3750-9d17-46a8-9a9f-3d581526cc2c`; `receipt.json`, `logs/runtime.log` and `json-hmr.png` retain its observations. No maintained implementation or dependency changed during this check.

## Observed behavior

The temporary WXT background entrypoint imports the maintained background. The HTML entrypoint imports the maintained panel. WXT launches and owns Firefox in a fresh temporary profile. Selenium attaches through geckodriver's native `--connect-existing --marionette-port` interface and uses ordinary DOM and shadow-root commands. The extension UUID comes from that owned profile's native `prefs.js` mapping, rather than an assumed or forced UUID.

- Two extension documents render the actual JSON counter. One rendered click updates both from zero to one.
- An action starts before the module update and remains pending in the backend.
- The only controlled source edit appends a unique DOM marker to `panel.ts`. Both documents receive it through native HMR, reconnect, retain counter one, and contain one rendered button.
- The first document's `performance.timeOrigin` remains `1790652210533`. Its provider incarnation remains `77140e7e-6a24-456e-b3a3-2e4b4eadc16d`; its native caller connection ID changes from `0` to `2`.
- One routed click returns two, and one rendered click brings both counters to three. This verifies exactly-once effects rather than inspecting Firefox's listener internals.
- Releasing the original pending backend action reports one started / one completed. After a further 750 ms, the replacement UI still displays its routed result `2`; the old completion has not overwritten it.
- No errors or unhandled rejections were captured by the document listeners installed after initial connection/rendering.
- Native WXT stop closes Firefox. All three cleanup operations fulfill. `panel.ts` is restored byte for byte to SHA-256 `26614a4d2ca1b06da70832deb4b85f9e7923ec2e3733a47532e782e9a0325a20`. A subsequent PID audit found every recorded owned Firefox process gone.

The fixture retains the already proven WXT runner-ownership and strict-declaration patches unchanged. It introduces no reloader, SDK API, native-auth override or additional runtime patch. Firefox's native extension-automation permission is enabled only in its isolated test process; CSP, origin checks and authentication are not disabled.

## Replay

First install and build the maintained repository's affected dependency graph using its normal pinned patches. Copy this fixture to a temporary directory. Ensure no other task is editing `examples/webext/src/panel.ts`; this check temporarily owns and restores that file.

```sh
pnpm install --frozen-lockfile --ignore-scripts
mkdir -p logs
DEVKIT_REPOSITORY=/absolute/path/to/devkit-extension PANEL_TEST_OWNERSHIP=available pnpm exec node check-firefox-json-hmr.mjs > logs/runtime.log 2>&1
pnpm exec tsc --noEmit -p tsconfig.json
```

The script requires the existing Firefox and geckodriver binaries declared near its top. This run used Firefox 156.0.1, geckodriver 0.37.1, Selenium 4.49.0, WXT 0.21.4, web-ext 10.7.0, Vite 8.3.0, TypeScript 7.0.2, pnpm 12.5.1 and Node 26.9.0. No browser or driver was downloaded. Adjust only the two binary paths for equivalent pinned binaries on another machine.

Frozen installation, script syntax, strict TS7 compilation with `skipLibCheck: false`, and strict type-aware Oxlint for the generated configuration/background shim passed. Lint uses the maintained repository's toolchain and configuration; its receipt is `logs/lint-from-host-toolchain.log`.

## Retained failures and limits

`logs/light-dom-selector-*` records an initial fixture selector that overlooked the renderer's shadow root. `logs/marionette-decode-*` and `logs/shadow-promise-*` retain attempts that called `.click()` before awaiting Selenium's shadow-root element promise. That fixture mistake left a command pending during shutdown and aborted the final receipt write; those partial receipts are not passing evidence. All occurred before the controlled panel edit. The final script follows the existing maintained Firefox tests' awaited shadow-root pattern.

`logs/first-passing-*` preserves the first complete success. Its generated background shim used an absolute import; strict lint required a relative import to the same source. The final run above passed after that correction. Expected geckodriver shutdown errors about an already closed browser connection are retained; owned-process cleanup is independently checked.

This proves one maintained JSON panel module update in two Firefox tabs. It does not prove toolbar-popup/DevTools/sidebar lifecycle, exact Port/listener counts, background or content updates, production watch, repeated rapid updates, global browser-console capture or every asynchronous mount failure. No upstream PR was opened.

Retain `RECEIPT.md`, `receipt.json`, `check-firefox-json-hmr.mjs`, `json-hmr.png`, `runner-only.patch`, `patches/`, `logs/`, `install.log`, package/lock/workspace files, `.npmrc`, `wxt.config.ts`, `tsconfig.json` and `entrypoints/`. Exclude generated `node_modules/`, `.wxt/` and `.output/` from source evidence.
