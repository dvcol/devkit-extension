# Live Devframe attachment to Vite preview: bounded feasibility result

The pinned public APIs support a live Devframe hub on a real Vite `PreviewServer`. A production-built browser page successfully called an action and received shared-state updates through a WebSocket attached to that preview server. This establishes attachment feasibility, not the complete server adapter contract or watched-build/HMR behavior.

## Evidence and versions

- Runtime: Node 26.9.0, pnpm 12.5.1, Vite 8.3.0, `devframe` 1.0.0, `@devframes/hub` 1.0.0. Direct dependencies are exact; `pnpm-lock.yaml` records the resolved dependency tree and integrity values.
- Browser: the available Chrome session, reporting Chrome 152 in its user agent. The in-app browser was unavailable. Only a newly created probe tab was used and it was closed afterward.
- `probe.ts`: real production build, preview server, public hub attachment, server assertions and shutdown.
- `browser-client.ts`: production-bundled released `connectDevframe` client, action/state checks and result reporting over the probe's separate loopback control route.
- `result.json`: successful final run, including observed browser reports and server-side assertions. The process exited 0.
- `cleanup.json`: independent post-run process and endpoint check.
- `validation.json`: lint and declaration-check command output, including the upstream-only failure baseline.
- `node-client-attempt.json`: retained failed preliminary attempt to use the browser high-level client directly in Node. It required a `location` global. No browser globals were fabricated; the final test ran the client in a real browser.

The audited public boundaries are [`@devframes/hub/initiate`](https://registry.npmjs.org/@devframes%2fhub/1.0.0), [`devframe/client`](https://registry.npmjs.org/devframe/1.0.0), and [Vite 8.3.0](https://registry.npmjs.org/vite/8.3.0). The corresponding pinned source documents [`HubInstance.attach`, `nodeMiddleware`, `ready`, and `close`](https://github.com/devframes/devframe/blob/18fa60effeb928eb445add2a536cd44906a59981/packages/hub/src/node/initiate.ts#L302). The released artifacts, rather than presumed complete source/build equivalence, are the operational baseline.

## Actual composition

The probe calls Vite's public `build()` and `preview()`. Its plugin implements `configurePreviewServer(server)`, verifies that the actual HTTP server is a Node HTTP server, and uses:

```ts
const hub = initHub({
  base: '/__probe/',
  configure(context) { /* register the bounded probe action/state */ },
  // Additional probe-only loopback configuration is in probe.ts.
})
const detachUpgrade = hub.attach(server.httpServer)
server.middlewares.use((request, response, next) => {
  if (!routeEnabled) return next()
  hub.nodeMiddleware(request, response, next)
})
await hub.ready
```

This excerpt is explanatory; `probe.ts` is the complete executed code. It does not construct, cast to, or pretend to have a `ViteDevServer`. The built browser client imports the released high-level client and discovers the live connection metadata from the preview origin. No source development server or sidecar was started. Headless hub settings disable authentication and MCP solely for the owned loopback probe; authenticated behavior was not tested.

## Observed behavior

1. Vite served its production-built HTML and bundled browser module. The hub advertised `backend: websocket` with `/__probe/__ws`, rather than static-snapshot metadata.
2. The hub's context reported `mode: dev` despite production-built UI assets. That value identifies its live backend lifetime; it does not change the Vite build output into source development mode.
3. The browser read initial state `0`, invoked `probe:increment(7)`, received raw value `7`, and observed the state broadcast `7`. The server independently verified one handler invocation and its state value.
4. A server-originated mutation produced the browser's second state observation, `11`. A deliberately failing action rejected with its expected message.
5. A second browser action reached a deliberately unresolved server handler. After detachment and hub close, its client promise rejected as a `DevframeConnectionError` with `kind: connection`; the browser reported `disconnected`.
6. HTTP upgrade listeners changed from `0` to `1` on attachment and back to `0` after calling the returned detach function.
7. Disabling the probe-owned middleware delegation and closing the hub left the preview HTTP server listening and serving the built HTML. The former metadata URL no longer returned JSON; Vite's SPA fallback served HTML.
8. The probe then awaited `PreviewServer.close()`, verified that the HTTP listener stopped, and exited. The browser tab was closed separately.

## Ownership and limits

The returned `detachUpgrade` handle proves removal of this attachment's upgrade listener. `hub.close()` plus the real browser's disconnect/rejected-call report proves the observed transport interruption. The probe-owned `routeEnabled` switch stops future delegation to its hub; it does not remove the Connect layer from the middleware stack. `PreviewServer.close()` owns final HTTP-server shutdown. The browser explicitly unsubscribes its observation and closes its client, but this probe does not measure every internal listener.

These handles do **not** prove that every contribution side effect has ended. The deliberately unresolved handler is not cancelled by this experiment; its lack of active I/O allows process exit. Complete activation cleanup, cancellation, service removal, repeated replacement, faulting cleanup and the prohibition on replacement before cleanup/reset must remain explicit later acceptance work. Public hub close documentation promises transport/MCP teardown, not a universal contribution disposer. [Public close contract](https://github.com/devframes/devframe/blob/18fa60effeb928eb445add2a536cd44906a59981/packages/hub/src/node/initiate.ts#L338).

Not tested: Vite DevTools hosting, authentication, SSE, HTTPS/HTTP2, middleware mode, JSON renderer mounting, production build watching, failed-build retention/status, generation publication, backend-module reload, HMR, and state restoration. No conclusions about those features follow from this passing attachment check. The selected last-successful-build policy remains a requirement, not observed behavior here.

## Type-checking result

Oxlint passes. Checking the probe source with `skipLibCheck` also passes, including the actual preview-server attachment without native-context casts. **Full declaration checking fails with ten diagnostics.** The imports-only `baseline-typecheck.ts` reproduces six: missing Bun/Cloudflare declarations from `crossws`, missing `cac` from Devframe's declarations, and an `h3` `override` declaration error. The probe additionally triggers four `TS2536` errors in Devframe's published scoped-state declaration signatures when its shared-state registry is augmented. Those four are not reproduced by the unaugmented baseline and remain unresolved; do not describe every failure as an identical imports-only result. `validation.json` preserves both outputs. The successful limited check is not full TypeScript conformance or approval of a blanket `skipLibCheck` policy.

## Reproduction

From this scratch directory:

```sh
pnpm install --frozen-lockfile --ignore-scripts --registry=https://registry.npmjs.org
pnpm exec oxlint probe.ts browser-client.ts baseline-typecheck.ts
pnpm exec tsc --noEmit
pnpm exec tsc --noEmit -p tsconfig.baseline.json
pnpm exec tsc --noEmit --skipLibCheck
pnpm probe
```

The two full declaration checks currently return nonzero as documented. Open the loopback URL printed by `pnpm probe` in a real browser within three minutes; the built page runs its checks automatically. The Node harness coordinates server mutation and shutdown, writes `result.json`, and closes the preview server in its cleanup path. Close the temporary browser tab afterward. The local registry setting avoids machine-specific registry assumptions, and the installed pnpm 12.5.1 is used directly without an unnecessary package-manager version switch.

## Decision implication

Same-server preview attachment has direct public-API and real-browser evidence. It needs neither a new Devframe transport nor a fake Vite development context.

The owner subsequently selected independently runnable `build:watch` and `preview` scripts, with `dev:production` running both in parallel using pnpm's script-name regex. Under that choice, the `preview` process owns HTTP serving and its attached live action/state backend; the build watcher remains a separate process. Failed builds retain the last complete successful output and display failure status.

The passing probe supports the attachment part of that arrangement only. It does not show that writing watched output directly into Vite's served directory preserves a complete prior generation. The implementation must prove how completed output becomes visible as a unit, how it retains the previous generation on failure, and how clients receive build status; staged output/publication is a candidate to evaluate, not an implemented guarantee. Backend-code restart and state restoration likewise remain separate from asset publication. The final adapter still needs explicit ownership, error handling and those remaining preview/watch lifecycle contracts.
