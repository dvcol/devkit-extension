# Native hosts attached to Vite preview

Executed 2026-09-24 against Vite 8.3.0, Node 26.9.0 and the locked native Devframe/DevTools packages, at repository commit `82a126535105ee96f289aee1db07746b9fcd1ee3`. This is a bounded feasibility result for issue 6.

The exact `preview.mjs` program creates handwritten static HTML in a temporary `dist` directory, starts actual `vite.preview()`, and uses public `configurePreviewServer` / `closePreviewServer` hooks. It mounts `initHub` for Devframe, and `createDevToolsContext` plus `createDevToolsHub` for DevTools, on the preview server's own HTTP server. The program imports the built public entry files and runs the maintained shared counter service/action through `@devkit/server`.

Both hosts passed: static HTML and native connection metadata returned HTTP 200; the local typed action returned 4; the owned command existed while running and disappeared on shutdown; provider disposal and native host cleanup completed before preview close returned. The process exited 0 and the script passes `node --check`. `preview-result.json` records outcomes; `SHA256SUMS.json` records exact file hashes.

This establishes same-process HTTP/backend attachment without a second backend process or a custom recovery controller. It does **not** establish an actual production build, build watcher, last-complete-build publication, remote SDK RPC, authentication behavior, browser-rendered UI or browser HMR. Authentication remained enabled, but no authenticated remote call was tested.

DevTools has an additional asset integration obligation. Vite preview resolves its configuration with `command: 'serve'`; `createDevToolsContext(preview.config)` therefore selects native mode `dev` but has no `viteServer`. In the released source, automatic branded-asset hosting runs only when a Vite server exists or the native mode is `build`. The probe does not solve that shell-asset path or supply a development module graph.

The script preserves its absolute checkout imports as exact executed evidence. To repeat from another checkout, build the relevant workspace graph, adapt those entry-file paths and run `node preview.mjs` with permission for temporary loopback listeners. This raw probe is separate from the maintained example and full mode-conformance tests.
