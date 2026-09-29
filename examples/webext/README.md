# Native WebExtension example

This Manifest V3 example runs the same background module as a Chromium service worker or a Firefox event page, with two packaged pages using the maintained `@devkit/webext` channel. It publishes a native JSON view, mounts the existing reference renderer and synchronizes native shared state. The worker installs the shared counter action/capability contracts through `@devkit/devframe`; both pages attach its catalog to `@devkit/client` for typed selection, broadcast and lifecycle updates. All runtime imports resolve through the workspace's pinned, patched Devframe 1.0 packages. No upstream checkout or source alias is required.

```sh
pnpm exec turbo run build --filter=@devkit/example-webext --concurrency=1
pnpm --filter @devkit/example-webext exec playwright install chromium
pnpm --filter @devkit/example-webext test:browser
pnpm --filter @devkit/example-webext test:firefox
```

Load `examples/webext/dist/chromium` unpacked in Chromium, or load `examples/webext/dist/firefox/manifest.json` as a temporary add-on from Firefox’s `about:debugging`. Open the extension's options page twice. The manifest also points its popup to that page; the automated test opens full pages and does not claim toolbar-popup lifecycle coverage. Its only host permission is `http://127.0.0.1/*`, for local backends and selected local pages. The `scripting` permission reads a native descriptor from a selected page.

```mermaid
flowchart LR
  A[Page A / router and renderer] <-->|runtime.Port| W
  B[Page B / router and renderer] <-->|runtime.Port| W
  W[Worker / sender admission] --> R[Native RPC / portable provider and catalog]
  R --> C[Shared counter action and capability contracts]
  C --> S[Native shared state / JSON view]
```

The worker admits only its own extension ID, expected channel name and exact packaged page URL. Its native RPC metadata retains each actual sender. The channel uses Devframe's records serializer. Native state accepts normal native writes, and view publication retains one context object for its index and duplicate detection. Each page owns its RPC close, state mirrors and renderer disposal. Disconnect does not cancel remote side effects or replay an action.

The Chromium test uses a disposable profile and removes it afterward. Its 24 scenarios cover native Port RPC/state/rendering and disposal, portable action/capability calls, catalog updates in both clients, configured-server routing and the selected-page handoff below. The [recorded run](./evidence/receipt.json) lists every scenario and passed with zero page errors. Fresh runs write their screenshot and receipt under ignored `artifacts/`.

![Native renderer using the installed workspace dependencies](./evidence/native-port-proof.png)

`pnpm --filter @devkit/example-webext test` also builds the extension and rejects Node or browser-external modules in the graph. Both build modes assert the expected native background manifest, permissions and CSP. CI runs these checks through the normal workspace gates, then executes both real-browser tests.

This is the native extension foundation. Automatic discovery, cross-provider rendering, full popup/DevTools/side-panel lifecycle, content/page request bridging, debugger support, full browser conformance and extension HMR remain open. Worker termination can reset in-memory state; persistence remains host/contribution-owned. The exact native dependency backports and their removal conditions are recorded in [the patch inventory](../../patches/README.md).

## Firefox execution

`test:firefox` uses Selenium WebDriver Classic with Firefox 156.0.1 and geckodriver 0.37.1. Selenium Manager resolves the driver; CI pins both versions. Set `FIREFOX_BINARY` to use a specific Firefox executable. For example, on macOS:

```sh
FIREFOX_BINARY=/Applications/Firefox.app/Contents/MacOS/firefox \
  SE_DRIVER_VERSION=0.37.1 SE_SKIP_DRIVER_IN_PATH=true pnpm --filter @devkit/example-webext test:firefox
```

The driver owns a temporary profile, assigns this add-on a test-only origin UUID and removes the session on exit. Its `--allow-system-access` option permits automation of `moz-extension` documents; it is never applied to a normal browsing profile. WebDriver Classic provides working extension-page navigation. Firefox BiDi currently omits extension-page lifecycle events, causing Puppeteer navigation to time out, as tracked in [Puppeteer #14314](https://github.com/puppeteer/puppeteer/issues/14314).

The [Firefox receipt](./evidence/firefox/receipt.json) records 18 scenario groups. They cover real Port RPC, native rendering/state, rich values, disconnection, catalog updates, mixed Devframe/DevTools/extension routing, native origin/auth rejection and selected-page handoff. These tests assert actual browser DOM and backend state. WebDriver Classic does not provide global page-error capture here, so this receipt makes no zero-page-error claim. The Chromium receipt still includes that assertion. Neither suite automates browser-toolbar popup, DevTools or side-panel lifecycle.

![Firefox native renderer and mixed-provider state](./evidence/firefox/native-port-proof.png)

The example declares `script-src 'self'` and limits `connect-src` to itself and loopback HTTP/WebSocket endpoints. This explicit CSP omits Firefox's default `upgrade-insecure-requests`, which otherwise upgrades the local `ws:` endpoint to `wss:` and prevents connection. [Mozilla documents this native behavior](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_Security_Policy#upgrade_insecure_network_requests_in_manifest_v3). Packaged code, host permissions, native origin admission and native RPC authentication remain enforced. No SDK transport or Devframe patch is added for Firefox.

## Provider and connection ownership

`src/provider.ts` defines the worker implementation of the same imported counter contracts used by the server examples. Its local native descriptor exposes the real JSON view; remote bindings contain only provider/execution metadata. The existing server adapter delegates to the same provider/catalog implementation, without pulling hub or kit dependencies into this worker.

Each page composes raw `createRpcClient`, its collector and native event emitter. Port closure calls `$close()` and emits the native disconnected status, so the shared adapter clears its catalog and local waits. The page then disposes its router, catalog subscription, state mirrors and renderer. Reopening the page creates a fresh connection to the same live provider, with no action replay.

The native entrypoint calls `startExampleBackground()` synchronously. Importing its implementation does not start a worker, which lets packaging tools inspect entrypoints safely. Startup reports asynchronous provider failures while registering `runtime.onConnect` immediately. Initialization failures are also visible to native RPC callers. Disabling the counter service invalidates both catalogs; the routed action rejects until the owner re-enables the service.

## Panel module replacement

The panel accepts native Vite HMR and disposes its old Port, renderer, router, subscriptions and DOM listeners before replacement. Abort signals prevent delayed commands or connection attempts from overwriting the replacement controls. They do not cancel remote side effects. Manual disconnect still displays pending-call errors.

A [standalone WXT development check](../../docs/research/wxt-json-hmr-evidence/RECEIPT.md) imports this maintained source and exercises the actual reference renderer in Chromium. It verifies the same document and background survive, the two old Ports close, exactly one routed-button listener remains, native state is retained, and post-update actions work without duplication. The WXT dependencies and runner/declaration patches remain in that standalone fixture. The maintained Vite build commands above do not yet provide extension development HMR, and Firefox renderer HMR, background/content replacement and watched production remain open.

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

These controls demonstrate application-owned explicit configuration. The selected-page alternative below uses the same owned connection setup. The reference JSON view still renders the extension provider's native state; cross-provider view composition remains separate work.

## Selected-page handoff

**Refresh local pages** lists currently permitted loopback tabs. Select a page, enter its configured provider ID, and choose **Connect selected page**. The example reads `DEVFRAME_CONNECTION_KEY` once through native `scripting.executeScript` in that tab's top-level MAIN world. It then passes the published `DevframeConnection` to the same native client setup, with `isolated: true`. Native credentials remain local to that connection; they never enter the provider registry or page controls.

```mermaid
flowchart LR
  Source[Selected page / native setupDevframeConnection] -->|published native descriptor| Read[Browser MAIN-world read]
  Read -->|isolated copy| RPC[Native client / backend auth]
  RPC --> Catalog[Existing provider adapter and router]
```

The browser supplies the selected tab/frame. The example checks only the native descriptor envelope, matching upstream's external-viewer integration. It does not authenticate page claims or duplicate Devframe's metadata types with a local schema. Browser host permissions, native server origin admission and native authentication still apply. Provider IDs remain application configuration because the native descriptor does not advertise SDK provider IDs.

`tests/selected-page.ts` serves a real Vite publisher whose native `setupDevframeConnection` fetches and publishes the descriptor. The extension adopts it and invokes the shared action. The test also verifies absent/malformed descriptors, a closed selection, and browser permission rejection for a tampered selection targeting `about:blank`. The publisher is not a fabricated Playwright connection object. Page errors from every browser page are collected.

This is a one-time handoff. Closing or navigating the source page does not retarget an already adopted backend connection; the extension page owns its disposal. The selected source gets no extension capabilities or RPC channel. No tab watcher, page-to-extension request protocol, persistent endpoint registry or credential store is added. Native `devtools.inspectedWindow.eval` remains the appropriate read API for an actual DevTools integration, whose surface lifecycle is still untested here.
