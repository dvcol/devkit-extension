# Native WebExtension example

This Manifest V3 example runs a module service worker and two packaged pages using the maintained `@devkit/webext` channel. It publishes a native JSON view, mounts the existing reference renderer and synchronizes native shared state. The worker installs the shared counter action/capability contracts through `@devkit/devframe`; both pages attach its catalog to `@devkit/client` for typed selection, broadcast and lifecycle updates. All runtime imports resolve through the workspace's pinned, patched Devframe 1.0 packages. No upstream checkout or source alias is required.

```sh
pnpm exec turbo run build --filter=@devkit/example-webext --concurrency=1
pnpm --filter @devkit/example-webext exec playwright install chromium
pnpm --filter @devkit/example-webext test:browser
```

Load `examples/webext/dist` unpacked in Chromium to explore it manually. Open the extension's options page twice. The manifest also points its popup to that page; the automated test opens full pages and does not claim toolbar-popup lifecycle coverage. Its only host permission is `http://127.0.0.1/*`, for explicitly configured local backends.

```mermaid
flowchart LR
  A[Page A / router and renderer] <-->|runtime.Port| W
  B[Page B / router and renderer] <-->|runtime.Port| W
  W[Worker / sender admission] --> R[Native RPC / portable provider and catalog]
  R --> C[Shared counter action and capability contracts]
  C --> S[Native shared state / JSON view]
```

The worker admits only its own extension ID, expected channel name and exact packaged page URL. Its native RPC metadata retains each actual sender. The channel uses Devframe's records serializer. Native state accepts normal native writes, and view publication retains one context object for its index and duplicate detection. Each page owns its RPC close, state mirrors and renderer disposal. Disconnect does not cancel remote side effects or replay an action.

The browser test uses a disposable Chromium profile and removes it afterward. Its 21 scenarios cover native Port RPC/state/rendering and disposal, portable action/capability calls, catalog updates in both clients, and the configured-server routing below. The [recorded run](./evidence/receipt.json) lists every scenario and passed with zero page errors. Fresh runs write their screenshot and receipt under ignored `artifacts/`.

![Native renderer using the installed workspace dependencies](./evidence/native-port-proof.png)

`pnpm --filter @devkit/example-webext test` also builds the extension and rejects Node or browser-external modules in the graph. CI runs that check through the normal workspace gates and then executes the real Chromium test.

This is the native extension foundation. Endpoint discovery, cross-provider rendering, full popup/DevTools/side-panel lifecycle, content/page bridging, debugger support, Firefox browser conformance and extension HMR remain open. Worker termination can reset in-memory state; persistence remains host/contribution-owned. The exact native dependency backports and their removal conditions are recorded in [the patch inventory](../../patches/README.md).

## Provider and connection ownership

`src/provider.ts` defines the worker implementation of the same imported counter contracts used by the server examples. Its local native descriptor exposes the real JSON view; remote bindings contain only provider/execution metadata. The existing server adapter delegates to the same provider/catalog implementation, without pulling hub or kit dependencies into this worker.

Each page composes raw `createRpcClient`, its collector and native event emitter. Port closure calls `$close()` and emits the native disconnected status, so the shared adapter clears its catalog and local waits. The page then disposes its router, catalog subscription, state mirrors and renderer. Reopening the page creates a fresh connection to the same live provider, with no action replay.

The worker registers `runtime.onConnect` synchronously. One narrowly scoped `prefer-top-level-await` lint exception permits reporting asynchronous provider startup failures without delaying worker event registration. Initialization failures are also visible to native RPC callers. Disabling the counter service invalidates both catalogs; the routed action rejects until the owner re-enables the service.

## Explicit native server connections

The form connects a base URL, configured provider ID and native authentication token through `connectDevframe({ connection: { isolated: true }, ... })`. `createDevframeProviderConnection` attaches its authorized catalog to the page's existing router. Each connection has its own native credentials and lifetime. Closing the page disposes these owned clients; startup failures close partially initialized clients. Tokens are cleared from the form and excluded from test logs.

The backend must include the actual extension origin, such as `chrome-extension://<installed-id>`, in native `initHub({ allowedOrigins })`. This is separate from native RPC authentication. Standard `initHub` does not publish the optional viewer-origin registration token, so calling `registerDevframeViewerOrigin` alone would not admit this viewer. The example uses the existing server option, without an upstream patch or disabling origin checks.

```mermaid
flowchart LR
  Form[Explicit local endpoint configuration] --> Client[Page router]
  Client -->|native isolated WebSocket| Devframe[Devframe provider]
  Client -->|native isolated WebSocket| Devtools[DevTools provider]
  Client -->|native Port| Extension[Extension provider]
  Devframe --> A[Native state A]
  Devtools --> B[Native state B]
  Extension --> C[Native state C / rendered counter]
```

`tests/configured-servers.ts` starts real Devframe and DevTools backends using the same imported counter contracts. It proves denied origin and invalid credentials leave counters unchanged, both authorized connections coexist, a devserver-only broadcast excludes the extension, and an all-realm broadcast updates all three providers. Explicit preference selects Devframe; after its shutdown, a new invocation falls back to the extension. A subsequent broadcast returns a rejected Devframe outcome and a fulfilled DevTools result. No request is replayed after dispatch.

These controls demonstrate application-owned explicit configuration. They do not implement tab scanning, page descriptor handoff, credential persistence, or a generic discovery policy. The reference JSON view still renders the extension provider's native state; cross-provider view composition remains separate work.
