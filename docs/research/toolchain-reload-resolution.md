## Resolution

Recommend TypeScript 7.0.2, Vite 8.3.0/Oxc, Oxlint 1.85.0 with oxlint-tsgolint 7.0.2002, pnpm 12.5.1 and Turbo 2.11.2 as the checked portable-package pipeline. Recommend WXT 0.21.4 as the extension-packaging candidate, conditional on the declaration and reload gates below. The custom Vite candidate is a working fallback. This research does not approve a blanket `skipLibCheck` setting or mark the later SDK implemented.

The comparison used identical shared application modules: a JSON document typed with public `Spec`, stored and in-memory counts, one increment action, one deliberate failure, and a content hook. Both candidates emitted Chrome/Firefox manifests and all planned HTML/script entry classes. The fixture has a literal HTML page; it does not claim compatibility with the existing reference renderer or native browser UI.

The second pass ran on macOS arm64/Node 26.9.0 with current stable Chrome for Testing 153.0.8010.52 and Firefox 156.0.1. It used isolated profiles. [Official Chromium metadata](https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json), [official Firefox metadata](https://product-details.mozilla.org/1.0/firefox_versions.json).

| Check                                                                     | Outcome                                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| TS7 checker/declaration emitter, strict portable compile, Oxlint controls | Passed independently                                                                                    |
| Two-workspace filtered Turbo graph                                        | Seven tasks passed; example-test failure propagated with exit 1, then restoration passed                |
| Standalone packed root ESM/types consumer                                 | Passed without workspace links or source aliases; full library checking enabled                         |
| Declaration-map packaging                                                 | Corrected to include mapped sources; both final map targets exist in the tarball                        |
| Browser boundary controls                                                 | Direct/transitive `node:fs` and one exact renderer sentinel rejected; portable input accepted           |
| WXT/custom production on both stable browsers                             | RPC, stored count update, deliberate action error and extension-page execution observed                 |
| WXT extension-page HMR                                                    | Updated content and unchanged document time origin in both browsers                                     |
| Custom extension-page update                                              | Same document in Chromium; document replacement in Firefox                                              |
| WXT Chromium content update                                               | Document replacement and subsequent successful action observed                                          |
| WXT Firefox background fallback                                           | New generation, reset memory count and retained stored count observed; exact triggering edit unresolved |
| WXT complete declaration check                                            | Failed minimum, described below; custom full declaration check passed                                   |
| Background/content reconnection and manifest adoption                     | Incomplete. Firefox explicit-reload and manifest raw matches were invalidated as stale-history evidence |
| Watched production build/preview                                          | First pass proved rebuild/error recovery; open preview required explicit reload                         |

The browser runner records failures and continues. Exit zero means the observation cases finished, not that all reload checks passed. Same-document HMR does not prove UI-local state retention or post-HMR click/listener behavior. The content result does not establish absence of duplicate listeners. A reporting timeout does not prove that the background failed to reload.

WXT supplies browser manifest and reload machinery that the custom candidate would require us to maintain. The custom candidate passed complete declaration checking and production execution, but it deliberately contains no content/background/manifest auto-reloader. CRXJS already passed minimal Chrome/Firefox builds in the first pass and remains a reserve candidate; no unsupported runtime claims are made.

The WXT minimum imports a type from `wxt/browser`. Including Chrome ambient types yields duplicate `HARFormatEntry`/`HARFormatLog` declarations from `@types/chrome` 0.3.0 and `@wxt-dev/browser` 0.3.0. Removing Chrome types yields unresolved `chrome` references. WXT's generated config skips library checks, but that only allowed this research adapter's authored sources to be checked; it did not resolve the incompatibility. Portable contracts, the custom candidate and packed consumer keep complete declaration checks. [Published WXT package](https://registry.npmjs.org/wxt/-/wxt-0.21.4.tgz), [browser declaration package](https://registry.npmjs.org/@wxt-dev/browser/-/browser-0.3.0.tgz).

The following handoffs are part of the decision:

- **[Release and conformance contract](https://github.com/dvcol/devkit-extension/issues/16), before adoption in [Portable contribution proof](https://github.com/dvcol/devkit-extension/issues/15):** make the retained WXT declaration minimum pass with full library checking and pinned dependencies. Keep strict portable contracts independent of packaging. If this cannot be resolved acceptably, use the custom Vite fallback.
- **[Live preview and reload contract](https://github.com/dvcol/devkit-extension/issues/13):** resolve external-runner integration and select retention behavior. Require a unique marker and report cursor for each change, explicit run/browser identity and manifest version, settled restorations, post-transition clicks, atomic command IDs and a duplicate-response observation window. Observe worker generation and content reconnection separately. Define watched-preview success/failure notifications.
- **[Examples and API coverage contract](https://github.com/dvcol/devkit-extension/issues/14):** implement an independent public API catalogue and example/test/host registry. A catalogue entry declares supported and unsupported hosts. Registry rows link each API to a runnable example and concrete automated assertions for those outcomes. Fail CI on unknown, missing or orphaned links. The audit's handwritten feature arrays prove only failure propagation; they do not implement this catalogue.
- **[Renderer and surface contract](https://github.com/dvcol/devkit-extension/issues/12) and [Portable contribution proof](https://github.com/dvcol/devkit-extension/issues/15):** exercise the actual reference renderer through valid host contexts. No fabricated extension Port/Devframe context was introduced here.
- **[Release and conformance contract](https://github.com/dvcol/devkit-extension/issues/16):** expand packed checks to every public export condition and real runtime dependency graph, then establish the Node baseline and full CI host matrix.

Retained evidence: local report `docs/research/toolchain-reload.md`, fixture/log directory `docs/research/toolchain-reload-v2-evidence/`, and its `reviewed-results.json`. Raw observations, negative controls, manifests, coherent lockfile and final scoped lint/type results are retained. No repository-wide validation, SDK implementation or upstream changes were performed.

The audit's Definition of Done is met through the measured pipeline, candidate comparison, explicit limitations and named follow-ups. Its closure does not waive the packaging gates or complete the SDK. `dvcol` is accountable for the handoffs until each contract has an assigned implementer.

Retained executable evidence is on local, unpushed branch `dvcol/research/toolchain-reload`, commit `d114ad2`, under `docs/research/`. The source-linked findings above are the public resolution; no hosted artifact URL is claimed.

### Minimal declaration failure

The retained `wxt-type-minimum/entry.ts` contains:

```ts
import type { Browser } from 'wxt/browser';
export type BrowserManifest = Browser.runtime.Manifest;
```

After `wxt prepare fixtures/wxt`, the TS7 minimum includes that file and the generated public-path declaration, with `strict: true`, `skipLibCheck: false`, `moduleResolution: "Bundler"` and `types: ["node", "chrome"]`. It rejects duplicate `HARFormatEntry`/`HARFormatLog` identifiers. Omitting `"chrome"` instead rejects unresolved references inside `@wxt-dev/browser`. Keep this negative case until a compatible pinned package/environment combination passes it.
