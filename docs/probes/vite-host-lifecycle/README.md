# Vite host lifecycle trace

Executed on 2026-09-23 with the installed **Vite 8.3.0 / Node 26.9.0**, using public `createServer`, `listen`, `restart` and `close` APIs. The [exact executed source](./trace.mjs) and [result](./result.json) establish Vite's lifecycle ordering. This probe does not execute either native Devframe/DevTools Vite integration or implement SDK reload wiring.

## Observed behavior

The real restart completed new `configureServer` setup and its returned post hook **before** old `buildEnd` and `closeBundle` began. Controlled promises then proved that restart remained pending while the old client `closeBundle` waited, and again while global `closeServer({ reason: 'restart' })` waited. These promises bound exact lifecycle milestones; no timer was used as cleanup proof.

```text
configure generation 1 → listen
restart requested
configure generation 2 → post hook generation 2
old buildEnd / closeBundle → old closeServer(reason: restart)
restart resolves
final closeBundle → closeServer(reason: close)
```

`closeBundle` ran for both `ssr` and `client` environments. In separate runs, throwing from `closeBundle` still allowed `server.close()` to resolve; throwing from `closeServer` rejected with the original error. All three owned HTTP servers were no longer listening at completion, and the disposable directory was removed. The Node process exited 0.

The public documentation describes [`closeServer`](https://vite.dev/guide/api-plugin.html#closeserver) as an awaited global hook after server teardown, with `restart` or `close` reason. It also distinguishes the post-middleware callback returned from `configureServer` from shutdown hooks. The source and observations matter here: a global teardown hook alone cannot prevent setup already performed by the replacement server.

## Exact released-source findings

These facts were read from public release artifacts, not inferred from a local checkout. `@devframes/vite@1.0.0` and `@vitejs/devtools@0.7.5` were fetched into memory only; neither was installed. File hashes are retained in [source-evidence.json](./source-evidence.json).

| Released source | Setup and disposal behavior |
| --- | --- |
| `@devframes/vite@1.0.0`, `dist/hub.mjs:28–99,117–138` | `viteDevframeHub` forwards `configure` to `initHub`. Its `configureServer` creates/mounts the hub but does not await `hub.ready`. Native teardown awaits hub close in `closeBundle`, clears its handle before waiting and suppresses close errors. An HTTP close listener also starts teardown without awaiting it. |
| `@devframes/hub@1.0.0`, `dist/node/initiate.mjs:119–159` | Within hub initialization, native service readiness, frame setup, `configure(context)` and UI setup are awaited in order. No portable contribution disposer is collected from the configure callback. The returned internal disposer in this range belongs to the optional MCP mount. |
| `@devframes/vite@1.0.0`, `dist/single.mjs:53–100` | The single bridge awaits `created.ready`; it uses a base Devframe context, not the hub context required by the current SDK installer. It suppresses previous-close errors and has no setup-returned contribution disposer. The static mount variant does not create a backend. |
| `@vitejs/devtools-kit@0.7.5`, `dist/node/index.js:214–229` | `createPluginFromDevframe` awaits `context.install(definition)`, then the optional kit setup callback. Its returned plugin supplies a `devtools.setup` hook and no teardown hook. The public setup return type is `void \| Promise<void>`. |
| `@vitejs/devtools@0.7.5`, `dist/plugins-C4WN3Ft6.js:250–320,550–591` | `configureServer` awaits actual DevTools context creation, which runs integration setup callbacks, then creates the native hub. Its `closeBundle` awaits native hub close. These callbacks run while Vite constructs the replacement server, not merely after replacement starts listening. |
| `@vitejs/devtools@0.7.5`, `dist/server-BIAKwFxh.js:132–169` | The native factory awaits hub readiness and returns its close method. It does not acquire the SDK provider handle. |
| `vite@8.3.0`, `dist/node/chunks/node.js:8015–8030,8199–8213,24311–24327,24519,24700–24728` | Replacement `_createServer` runs configure hooks before old close. Per-environment cleanup is awaited through `allSettled`, then global `closeServer` through `Promise.all`. This explains the observed failure difference. Ordinary `closeBundle` hooks run in parallel unless explicitly sequential. |

Vite's config-change branch (`dist/node/chunks/node.js:24889–24913`) restarts when the changed file is the config, a recorded config dependency, or a recognized environment file. Ordinary frontend HMR does not by itself rerun native backend setup. This probe uses explicit `server.restart()`; it does not prove a particular authoring module is watched or re-imported under every config loader.

## Reproduce

Use this repository's installed dependency graph. Run from the repository root because the retained script is the exact stdin program and resolves the local Vite artifact from that directory:

```sh
node --input-type=module < docs/probes/vite-host-lifecycle/trace.mjs
```

The program creates disposable loopback listeners and closes them. A restricted sandbox may require permission for those listeners. It disables file watching and browser HMR, so the result covers public explicit restart semantics. It accesses no browser or existing server and changes no dependencies or repository sources.

The exact source passes Node syntax and default Oxlint. It is an executed research archive, not maintained SDK code: the full repository type-aware/pedantic profile did not pass. The [validation record](./validation.json) preserves the check boundaries and findings; ignored repository checks are not reported as successes.

## Next bounded native-host proof

Run the two real integration paths separately: `viteDevframeHub({ ui: false, configure })`, and the actual `DevTools` host plus `createPluginFromDevframe(..., { setup })`. Install one portable composition with visible setup/cleanup receipts and a deliberately delayed cleanup. Verify actual context identity, one provider incarnation per installation, setup readiness, old/new overlap, handler availability during teardown and cleanup failures. Then prove a recorded backend config dependency change re-imports the intended declaration using the chosen Vite config loader. Middleware-mode and preview ownership need separately named assertions.

No integration strategy is selected by this trace. In particular, staging setup or delaying activation until listening still needs proof against native readiness, middleware mode and config reload. A new native context alone does not establish exclusive ownership of the same logical provider's external resources. No supervisor, recovery controller, upstream patch or SDK lifecycle change was implemented.
