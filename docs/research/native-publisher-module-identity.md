# Native publisher module identity

The pinned `@devframes/json-render@1.0.0` can resolve through two pnpm peer-dependency contexts in the WebExtension example. Both contain the same patched release, but Vite previously bundled separate native `createJsonRenderView` modules. Each copy owns a separate native view index for the same publication context. The management view mounted while the counter view was absent.

Both Chromium and Firefox startup failures reproduced from unchanged `944501a` source in an isolated archive using the same installed dependencies and native browser settings. They occurred before any response-body contribution was installed. The unit storage fixture also reproduced the missing native view index on unchanged source. This established module identity as a host integration defect rather than a response handler or startup-timing failure.

The example now uses Vite's native `resolve.dedupe: ['@devframes/json-render']` in its production and WXT configurations. Vitest uses the same setting and inlines the packaged publication so its external-module optimization does not bypass that resolution. No native factory, index, RPC, state or SDK lifecycle is replaced.

The existing production bundle tests assert exactly one native publisher module. Without deduplication, the compiled background contained two publisher/index owners; with it, the baseline Chromium browser suite restored the counter and passed. Affected strict lint, TypeScript 7, unit tests, both production builds and all four native Chromium/Firefox production/development suites pass with one native publisher module.

This check concerns the workspace's identical pinned native release. It does not establish compatibility between different native versions. It also does not explain the separate CI reference-renderer republication failure at `Counter: 6`; that state-timing failure has its own investigation.

[Vite dependency deduplication](https://vite.dev/config/shared-options.html#resolve-dedupe), [Vitest dependency inlining](https://vitest.dev/config/server.html#server-deps-inline).
