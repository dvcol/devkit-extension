# Toolchain and reload audit

Research date: 2026-09-22, Asia/Tokyo. Decision [#4](https://github.com/dvcol/devkit-extension/issues/4), branch `dvcol/research/toolchain-reload`.

## Decision and scope

Use TypeScript 7 for the portable package checker/declaration compiler, Vite 8/Oxc for builds, Oxlint with its matching type-aware engine, and pnpm/Turbo for scoped workspaces. These mechanisms worked independently and together in the bounded fixture.

Recommend WXT as the maintained extension-packaging baseline, conditional on resolving its declaration and development-reload integration gaps before adopting it in the strict SDK workspace. The small custom Vite candidate proves a fallback is feasible, but it requires owned manifest handling and extension/content reload automation. Keep portable contracts and their build independent from either packager. CRXJS remains a previously tested build alternative; no runtime comparison was needed to establish this recommendation.

This second pass supersedes the first report's instruction to keep the audit open until full SDK conformance exists. The actual ticket requires a reproducible recommendation, observations, enforcement mechanisms and precise follow-ups. It does not require implementing the later renderer, reload, state or example contracts. The research is closed with its [published resolution](https://github.com/dvcol/devkit-extension/issues/4#issuecomment-5778484961); this is conditional WXT selection and does not certify the SDK.

## Versions and evidence

The second pass used macOS arm64, Node 26.9.0, pnpm 12.5.1, TypeScript 7.0.2, Vite 8.3.0, Oxlint 1.85.0, oxlint-tsgolint 7.0.2002, Turbo 2.11.2, Vitest 5.0.1, Playwright 1.63.0, WXT 0.21.4 and web-ext 10.7.0. Additional declaration inputs were `@types/node` 26.6.2, `@types/chrome` 0.3.0, Rollup 4.63.4 and `@devframes/json-render` 1.0.0. Exact dependency resolutions are retained in the workspace lockfile and [environment record](./toolchain-reload-v2-evidence/environment.json).

Browser execution used isolated profiles and Chrome for Testing 153.0.8010.52 and Firefox 156.0.1. Those were the current stable assets retrieved for this pass. The baseline advances with stable releases; no ESR or historical-version matrix was added. Earlier Chromium 153.0.8010.12 and Firefox 156.0 observations remain historical evidence. [Chrome for Testing metadata](https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json), [Mozilla version metadata](https://product-details.mozilla.org/1.0/firefox_versions.json).

Evidence is split into the [original compiler/watch probe](./toolchain-reload-evidence/README.md) and [second-pass candidate comparison](./toolchain-reload-v2-evidence/README.md). Read [reviewed-results.json](./toolchain-reload-v2-evidence/reviewed-results.json) before raw reload results: it invalidates two stale-history matches and narrows several other observations. Browser-runner exit zero means the observation cases completed, not that every reload succeeded.

Only disposable fixtures ran. No application-wide build/lint/test command ran. The original fixtures had been removed, so this pass rebuilt its environment from retained inputs. Turbo's default shared-worktree cache unexpectedly placed research cache files in the main checkout; the coordinator relocated that owned cache. Future commands explicitly set a probe-local cache directory.

## What the common fixture proves

Both packaging candidates consume the same application modules: a JSON specification checked with the public `Spec` type, a stored count, an in-memory count, an increment action, an intentional error response, and a content-script hook. The literal HTML page displays the response and imports the same spec/action identifiers. Chrome uses an MV3 service worker; Firefox uses an MV3 background script. Both emit popup, options, sidepanel/sidebar, Devtools-page and page-world artifacts.

This proves packaging and a small action/state/content path. It does not mount the existing reference JSON renderer or implement a generic renderer. Extension HTML was opened in an extension tab, not through native popup or Devtools UI. The page-world artifact was built but not exercised here; timing and execution-world behavior belong to the browser/injection decisions.

The public reference renderer is located at build time through `jsonRenderUiRenderer().file` from `@devframes/json-render-ui/hub`. Its client contract is richer than a raw extension Port. No fabricated Devframe client context was used. The future extension renderer adapter remains [#12](https://github.com/dvcol/devkit-extension/issues/12).

## Measured results

| Experiment                                                          | Result                                | Bound of the claim                                                                                           |
| ------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| TS7 checking, declaration emit and original strict Oxlint controls  | Passed                                | Independent compiler, lint and error controls are retained from the first pass                               |
| Portable contract compile with ECMAScript libraries and `types: []` | Passed                                | No DOM or Node ambient types needed by the synthetic contract                                                |
| Two-workspace Turbo graph                                           | Passed                                | Selected only SDK and example; seven available tasks passed, three cached in the recorded final positive run |
| Example-test failure through Turbo                                  | Expected failure, then restored pass  | A changed expectation returned exit 1; restored example returned exit 0                                      |
| Missing synthetic declared-feature item                             | Expected failure                      | Handwritten-array equality fails; this does not discover the real public API/host matrix                     |
| Packed root ESM export in separate consumer                         | Passed                                | No workspace reference or source alias; full declaration checking and runtime import succeeded               |
| Declaration-map source targets                                      | Passed after packaging correction     | Final tarball includes `src`; both map targets exist in it                                                   |
| Browser import enforcement                                          | Positive and negative controls passed | Direct/transitive `node:fs` and one explicit renderer sentinel were rejected by the resolver plugin          |
| WXT and custom production packages, both browsers                   | Observed                              | Content/background RPC, incremented stored count, intentional error and extension-page execution             |
| Production HTML and source maps                                     | Passed artifact inspection            | Script URLs resolve to local packaged files; source maps emitted for each candidate                          |
| WXT full declaration checking                                       | Failed                                | Minimal ambient-type overlap remains unresolved, detailed below                                              |
| Custom package full declaration checking                            | Passed                                | Same shared application modules, native browser types and Vite build script                                  |
| Authored-source lint/type checks                                    | Passed with disclosed adapter limit   | WXT-inclusive check skips third-party declarations; portable/custom/consumer checks do not                   |
| Vite watched build and preview                                      | Previously observed                   | Rebuild required explicit page reload; invalid rebuild preserved last HTML; repair recovered                 |

The root-export result is not proof of every conditional export. The synthetic renderer sentinel establishes an enforcement mechanism, not a complete real-package dependency policy. SDK has no test script in this two-package probe; the example supplies its tests. Exact `expect.assertions(2)` and `expect.assertions(1)` are used.

## Candidate comparison and reload observations

| Area                                   | WXT 0.21.4                                                     | Small custom Vite integration                                                         |
| -------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Browser manifests and entrypoints      | Maintained mapping; both browser variants built and ran        | Explicit Chrome/Firefox mapping and separate HTML/background/content builds; both ran |
| Framework requirement                  | None in fixture application code                               | None in fixture application code                                                      |
| Production CSP                         | Shared fixture ran under generated production manifests        | Shared fixture ran under default production extension CSP                             |
| Extension-page update, Chromium        | Updated label with unchanged document time origin              | Updated label with unchanged document time origin                                     |
| Extension-page update, Firefox         | Updated label with unchanged document time origin              | Label updated with a changed document time origin; HMR not established                |
| Content dependency update, Chromium    | New document/content generation and subsequent action observed | Automatic content reload not implemented                                              |
| Content dependency update, Firefox     | New generation not observed before timeout                     | Automatic content reload not implemented                                              |
| Background/manifest development update | Recovery observations incomplete with external browser runners | Automatic extension reload not implemented                                            |
| Complete declaration checking          | Ambient-type failure                                           | Passed                                                                                |

Page time-origin evidence supports module update within the same extension document. It does not prove UI-local state retention or post-HMR button/listener correctness. Chromium's content update replaced the inspected document. One successful action afterward does not prove in-document cleanup or absence of duplicate listeners; concurrent increments in this fixture are not atomic.

The shared background dependency edit timed out in both externally launched browsers. During the bounded Firefox fallback sequence, a newer background boot/version appeared with the stored count retained and the in-memory count reset. Because a direct entrypoint edit followed the earlier dependency edit, the precise triggering edit is unresolved. Chromium stopped reporting during its fallback; this does not establish whether the worker rebuilt, reloaded or failed to reconnect.

Two raw statuses must not be treated as successes. Firefox's explicit-reload predicate reused the preceding observation. Its manifest predicate matched older history. Both are **INVALID as reload evidence** in the reviewed results. Manifest adoption remains unverified for both browsers. Raw output is retained unchanged for review.

WXT was configured with its own browser launcher disabled and driven by Playwright or web-ext. These results describe that integration. They do not establish that WXT's normal managed runner has the same limitations. WXT documents separate content and page behavior, and its published reloader distinguishes content, HTML and extension operations. [WXT content scripts](https://wxt.dev/guide/essentials/content-scripts), [WXT module behavior](https://wxt.dev/guide/essentials/es-modules), [WXT 0.21.4 artifact](https://registry.npmjs.org/wxt/-/wxt-0.21.4.tgz).

WXT remains the first maintained choice because it supplies manifest and reload machinery that the working custom candidate would require us to own. Its current declaration and runner findings are adoption gates. A strict portable package must not inherit its declaration workaround.

## Declaration compatibility finding

The minimal reproduction imports a type from `wxt/browser` and includes only its generated public-path augmentation. With `@types/chrome` 0.3.0, TypeScript 7 reports duplicate `HARFormatEntry` and `HARFormatLog` identifiers in the Chrome and `@wxt-dev/browser` 0.3.0 declarations. Removing Chrome ambient types instead exposes unresolved `chrome` references in the latter package. This is smaller than the application fixture and no longer depends on the generated i18n declaration.

The earlier full WXT-generated declaration set also referred to an unresolved `I18n` namespace. That secondary failure is retained in scratch history but is not needed for the primary minimum. WXT's generated tsconfig uses `skipLibCheck: true`. The authored-source check follows that setting only for this adapter/runner experiment and is explicitly not full declaration-compatibility proof. The custom candidate, portable contract and clean consumer use complete library checking and pass.

The needed follow-up is a declaration/environment compatibility fix, not a blanket TypeScript downgrade. TypeScript 7's CLI checker and declarations worked here. Tools depending on its historical JavaScript compiler API need separate verification. [TypeScript 7 release](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), [published browser declarations](https://registry.npmjs.org/@wxt-dev/browser/-/browser-0.3.0.tgz), [Chrome declaration package](https://registry.npmjs.org/@types/chrome/-/chrome-0.3.0.tgz).

## Reproduction and enforcement

The [second-pass README](./toolchain-reload-v2-evidence/README.md) describes input files, negative controls and sanitization. From its `probe/` directory, install the pinned workspace through the public registry, then run narrow commands:

```sh
pnpm install --ignore-scripts
pnpm exec turbo run build check-types lint test --filter=@probe/example... --dry=json --cache-dir=.cache/turbo
pnpm exec turbo run build check-types lint test --filter=@probe/example... --concurrency=1 --cache-dir=.cache/turbo
pnpm exec tsc --project fixtures/sdk/tsconfig.portable.json
pnpm exec tsc --project tsconfig.custom.json
pnpm exec wxt prepare fixtures/wxt
pnpm exec tsc --project tsconfig.check.json
node scripts/boundary-checks.ts
pnpm --dir fixtures/sdk pack --pack-destination ../../../artifacts
```

Install that tarball in `standalone-consumer/` and run the retained standalone compiler command. The tarball is generated, not stored in the bundle. Build WXT with `wxt build fixtures/wxt -b chrome --mv3` and the corresponding Firefox command; build the custom candidate with `node scripts/custom-build.ts chrome` and `firefox`.

For browsers, set `PROBE_CHROME_BINARY` and `PROBE_FIREFOX_BINARY` to the separately obtained stable binaries. `PROBE_MODE=production node scripts/reload-probes.ts` exercises compiled packages. Without that setting the runner observes development updates; `PROBE_CANDIDATE=wxt` limits the fallback sequence. Interpret its per-step records using the review caveats, not its exit code. Browser profiles are disposable. No native computer control is required.

Use a real resolver/bundle graph policy for runtime boundaries; a text search of minified output is insufficient. The demonstrated plugin rejects forbidden resolved inputs before bundling. Keep a separately owned API catalogue and example/test/host registry; their independent cross-check must detect missing or unsupported rows. The synthetic equality control only establishes task failure propagation. [Node conditional exports](https://nodejs.org/api/packages.html#conditional-exports), [Turbo run semantics](https://turborepo.dev/docs/reference/run), [Oxlint type-aware engine](https://oxc.rs/docs/guide/usage/linter/type-aware).

## Follow-up ownership and acceptance

| Owner                                                                                                                                                      | Follow-up                                         | Acceptance                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolchain maintainer / release decision [#16](https://github.com/dvcol/devkit-extension/issues/16)                                                         | WXT declaration compatibility                     | Retained minimum passes full library checking with pinned packages and no ambient duplication; portable packages never require `skipLibCheck`                                                                                                                         |
| Reload decision [#13](https://github.com/dvcol/devkit-extension/issues/13)                                                                                 | External-runner lifecycle proof and integration   | Fresh marker and report cursor per mutation; run/candidate/browser identity and runtime manifest version; settled restorations; separate backend/reconnection observations; post-transition clicks and atomic command IDs with a duplicate-response collection window |
| Reload decision [#13](https://github.com/dvcol/devkit-extension/issues/13)                                                                                 | Compiled preview notifications and failure policy | Successful generations notify preview clients, failed generations are explicit, and last-good-output/reload/retention rules are specified                                                                                                                             |
| Examples decision [#14](https://github.com/dvcol/devkit-extension/issues/14)                                                                               | Actual public API/example/test/host catalogue     | Independently declared inventories detect missing API, example, assertion and host/unsupported rows; deleting one real linkage fails CI                                                                                                                               |
| Renderer decision [#12](https://github.com/dvcol/devkit-extension/issues/12) and portable proof [#15](https://github.com/dvcol/devkit-extension/issues/15) | Real renderer/client and host integration         | Existing public JSON renderer runs against valid host contexts, then the same contribution exercises supported hosts without fabricated Devframe context                                                                                                              |
| Release decision [#16](https://github.com/dvcol/devkit-extension/issues/16)                                                                                | Package and CI expansion                          | All public export conditions and real runtime entry graphs checked from tarballs; chosen Node baseline, lint inventory and stable-browser CI enforced                                                                                                                 |

## Actual audit Definition of Done

- [x] Exact versions, commands, artifacts and candidate observations recorded.
- [x] Maintained versus custom recommendation explains tradeoffs and deferred implementation.
- [x] TypeScript, declaration emit, strict linting and packed root consumption verified independently, with WXT's declaration failure disclosed.
- [x] Development document updates and compiled-preview behavior distinguished with observations.
- [x] Runtime import enforcement and scoped test orchestration demonstrated; full inventory enforcement has a concrete owner and acceptance criteria.
- [x] Unresolved declaration/reload cases have retained reproductions and named follow-up owners; ambiguous browser observations are explicitly invalidated.

The research ticket is closed with the conditional packaging decision and handoffs published. The adoption gates and later SDK features remain open.
