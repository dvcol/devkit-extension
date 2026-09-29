# WXT strict declaration gate

Date: 2026-09-29. Isolated fixture; no maintained repository changes and no browser launches.

Pinned packages: WXT 0.21.4, @wxt-dev/browser 0.3.0, TypeScript 7.0.2, Vite 8.3.0, @types/chrome 0.3.0, @types/node 26.6.1. Complete checking additionally requires Rollup 4.63.4, whose declarations WXT's visualizer imports despite marking the peer optional. pnpm 12.5.1; commands executed by pnpm used Node 26.9.0.

All configurations retain the repository's strict compiler flags and `skipLibCheck: false`. Browser fixtures add DOM libraries. Full configurations extend `.wxt/tsconfig.json`, include every generated `.wxt/**/*.d.ts`, the real WXT config, background entrypoint and `type-contracts.ts`. Patch staging directories are not application source inputs.

## Observations

| Phase | Minimum with Chrome | Minimum without Chrome | Full with Chrome | Full without Chrome |
| --- | --- | --- | --- | --- |
| Original packages | Duplicate HAR aliases | Unresolved chrome | HAR aliases + unresolved I18n + missing Rollup | chrome + unresolved I18n + missing Rollup |
| Browser declaration patch | Pass | Pass | I18n + missing Rollup | I18n + missing Rollup |
| Browser patch plus Rollup | Pass | Pass | I18n only | Same remaining reference |
| Both patches plus Rollup | Pass | Pass | Pass | Pass |

The first three phases are retained in `logs/baseline-*.log`, `logs/browser-patched-*.log` and `logs/browser-patched-with-rollup.log`. The last intermediate Rollup-only phase directly reran the full with-Chrome case.

The final verifier freshly generated Chrome MV3 and Firefox MV3 declarations using WXT's public `prepare` API, then passed all four cases for each browser. `results.json` records all 14 commands and successful statuses, including four effective-config assertions. Compiler diagnostics are retained in `logs/final-*.log`.

`type-contracts.ts` verifies that generated message keys stay narrow, native i18n methods remain available and typed, and HAR entry properties remain typed. Five `@ts-expect-error` cases would fail if those APIs were widened improperly.

## Minimal corrections

- `patches/@wxt-dev__browser@0.3.0.patch`: use module-scoped HAR type imports and replace two obsolete `typeof chrome` references with `typeof Browser`. No runtime JavaScript changes.
- `patches/wxt@0.21.4.patch`: import the current public `Browser` type and replace the obsolete `I18n.Static` base with `Omit<typeof Browser.i18n, "getMessage">` in the declaration template. This preserves native methods for both direct `WxtI18n` consumers and `browser.i18n`, while generated message keys remain narrow. This changes generated declarations, not extension runtime behavior.

A first candidate simply removed the obsolete base. It compiled `browser.i18n` because WXT intersects native methods into `WxtBrowser`, but lost native methods on directly imported `WxtI18n`. `logs/removed-base-negative-control.log` proves that candidate rejects direct `getUILanguage` and `getAcceptLanguages` consumers. The retained patch corrects this defect; final checks include direct consumers.
- Explicit Rollup 4.63.4 peer in this fixture. No peer-type shim or skipped library check.

## Reproduce

From this directory:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec node verify.mjs
```

The frozen install passed. Offline install could not access every tarball snapshot despite installed packages being available; use normal public-registry installation. `.npmrc` points only at the public npm registry and contains no credentials. Existing dependencies and native binaries may be reused from pnpm's cache.

Original patch workflow:

```sh
pnpm patch @wxt-dev/browser@0.3.0 --edit-dir patch-browser
# Apply the retained browser diff to patch-browser/src/gen/index.d.ts.
pnpm patch-commit patch-browser
pnpm patch wxt@0.21.4 --edit-dir patch-wxt
# Apply the retained WXT diff to patch-wxt/dist/core/generate-wxt-dir.mjs.
pnpm patch-commit patch-wxt
pnpm exec wxt prepare
pnpm exec tsc --noEmit -p minimum/tsconfig.with-chrome.json
pnpm exec tsc --noEmit -p minimum/tsconfig.without-chrome.json
pnpm exec tsc --noEmit -p tsconfig.with-chrome.json
pnpm exec tsc --noEmit -p tsconfig.without-chrome.json
```

Browser-specific preparation uses `prepare({ browser: 'firefox', manifestVersion: 3 })` from the public `wxt` entrypoint. The `wxt prepare` CLI does not accept `-b`; the rejected exploratory invocation is retained separately and is not counted as evidence.

This establishes the declaration gate only. It does not establish build/runtime/HMR conformance, upstream acceptance, or adoption into the maintained extension.
