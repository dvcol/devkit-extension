# Native server context examples

This package runs the same counter capability and action in a real `DevframeHubContext` and a real `KitNodeContext`. It imports the unchanged contracts from `@devkit/example-contribution`. Both hosts start the same service and action plugin through `createDevframeProvider` / `createDevToolsProvider` from `@devkit/server`.

The service uses the typed `devframeHubContext` descriptor to access native shared state and registers a native command that reads the counter. Its activation owns that command. Disabling the service removes the command and puts the dependent action into waiting. Enabling the service registers the command again and reuses the host's retained counter state.

`src/host.ts` constructs the contexts with public `createHubContext` and `createKitContext` factories, then initializes a headless hub. It uses a temporary storage directory, opens no network listener, and closes the hub before removing the directory. The adapter owns its contributions; the example owns the native host.

## Run

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @devkit/example-server-contexts... run build
pnpm --filter @devkit/example-server-contexts run demo:devframe
pnpm --filter @devkit/example-server-contexts run demo:devtools
pnpm --filter @devkit/example-server-contexts run demo:routing
pnpm --filter @devkit/example-server-contexts run demo:remote
pnpm --filter @devkit/example-server-contexts run test
```

Each demo prints its configured provider ID, adapter-issued incarnation, execution descriptor and actual native context availability. The first action and capability read return `3`. After disabling and enabling the service, the next action and native command return `7`. The incarnation stays unchanged across activation changes. Provider disposal removes the owned command while the native shared state still contains `7`. The runner then closes the host.

The executable check imports the built package exports and runs both paths, asserting these values and statuses. It exits unsuccessfully if either path fails. Each runner awaits host cleanup before its promise fulfills. It does not mock context construction, state, service calls, actions or cleanup.

```sh
pnpm --filter @devkit/example-server-contexts run typecheck
pnpm --filter @devkit/example-server-contexts run lint
pnpm --filter @devkit/example-server-contexts run format:check
```

## Two-provider routing

`demo:routing` creates both native hosts together and attaches their provider handles to `@devkit/client`. An ordered default initially increments the Devframe counter to `3`. Disabling that service routes the next increment to DevTools, reaching `4`; a callback selects DevTools again, reaching `6`. After re-enabling Devframe, a broadcast requesting its provider and a missing provider rejects before dispatch. Capability broadcast reads confirm unchanged counters `[3, 6]`.

A broadcast with overlapping realm/provider selectors then increments each counter once, returning `[4, 7]`. Client disposal leaves native commands and state alive; reading them still returns `[4, 7]`. The runner subsequently disposes both providers and closes both hosts. `checks/routing.ts` asserts these receipts through the built package export.

## Authenticated native RPC

`demo:remote` opens a temporary loopback HTTP/WebSocket host for each native context. It reuses the same counter contracts and implementations, Devframe's `createInteractiveAuth`, named native RPC definitions, and the public `createRpcClient` / `createWsRpcChannel` exports. Node's actual WebSocket implements the client channel; no browser globals or transport mocks are installed. Every run creates a fresh in-memory credential and temporary storage directory. It prints no credentials, removes its storage, and closes both sockets and hosts before returning. Expected auth, validation and disposed-provider failures produce native diagnostics during the check.

The example supplies services, plugins and `expose` in one provider startup call. The adapter registers four host-owned methods: the action, the capability’s `read` and `increase` operations, and its catalog query. Each captures its provider, checks the expected incarnation and delegates through the existing lifecycle. Two example-only native probes inspect session trust and handler behavior across disconnect. None is advertised as an agent tool.

```mermaid
flowchart LR
  Client["Native RPC client and WebSocket channel"] --> Auth["Native token/session authorization"]
  Auth --> Method["Named host-owned counter method"]
  Method --> Provider["Selected provider incarnation"]
  Provider --> Action["Existing shared counter contribution"]
```

`checks/remote.ts` runs the built package export on both Devframe and DevTools and asserts:

| Scenario                                          | Observable result                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Invalid credential                                | Native authorization rejects; the counter is unchanged.                                       |
| Valid credential                                  | The action returns `3` and its native session is trusted.                                     |
| Capability operations                             | Reading returns `3`; increasing by `2` returns `5` through the same native boundary.          |
| Invalid input                                     | Native schema validation rejects before a counter change.                                     |
| Provider disposal                                 | Its action rejects; unrelated HTTP still returns `host-alive`.                                |
| Same-ID provider replacement                      | The old incarnation rejects; a fresh call returns `9`, using retained native state.           |
| Actual native host shutdown during a pending call | The channel closes the native RPC client and the pending client call rejects.                 |
| Already-started server handler after disconnect   | Releasing its gate still lets it finish. Client rejection does not prove server cancellation. |
| Host-owned declaration count                      | The four adapter methods remain registered across provider replacement; no names accumulate.  |

The low-level native client needs its `$close()` connected to the channel's disconnect/error callbacks. The example does that directly, with no additional request-ID registry or RPC codec. The native high-level browser client already owns its own connection guards. A five-second native RPC timeout bounds failed calls in this executable example; it is not a server-side cancellation mechanism.

The [native lifecycle investigation](../../docs/research/native-rpc-lifecycle.md) records missing coherent dynamic RPC removal and server-side ordinary-call cancellation through an existing hub. The owner has since selected host-owned remote methods, which avoids requiring dynamic removal. The combined startup API is implemented. The native remote client and catalog synchronization are now implemented. Native backend unary cancellation remains absent, as accepted by the owner.

## Browser client

```sh
pnpm exec turbo run build --filter=@devkit/example-server-contexts...
pnpm --filter @devkit/example-server-contexts demo:browser devframe
# Or run against the native DevTools backend:
pnpm --filter @devkit/example-server-contexts demo:browser devtools
```

Open the printed loopback URL. The page creates an isolated native `connectDevframe` client and passes it to `createDevframeProviderConnection` from `@devkit/server/client`. The shared router resolves the counter capability, then invokes the shared action when the button is pressed. No credentials are printed or stored in browser caches. The launcher injects its temporary demo credential into its loopback-only Vite page and proxies the native endpoint; use application-owned authentication in a real host.

Both hosts were checked in the in-app browser: initial value `0`, action result `1`, then reload reads `1` with the same provider incarnation. The page owns its native client; page/HMR disposal releases the shared client, adapter subscriptions and native socket. The launcher owns the backend and Vite server; press Enter to close both and remove temporary storage. This is a diagnostic page for transport verification, not the JSON renderer example.

`checks/browser-build.ts` builds the browser entry using public package exports and rejects Node shims or backend runtime modules. Server-package socket tests additionally exercise authenticated catalog reads, invalid metadata, disable/enable, replacement, stale-query fencing, startup cancellation and caller/client/adapter/disconnect cancellation. Each cancellation path stops waiting while the backend finishes once. Test-only `location` supplies the environment required by the native browser client; transport, auth and handlers are real.

## Scope

The local demos exercise in-process routing; `demo:remote` checks low-level native RPC on both hosts; `demo:browser` uses the shared routed client over an actual native browser connection. Catalog synchronization is implemented for explicit exposure. Automatic endpoint discovery, browser capability authority, the JSON renderer, extension execution and complete browser HMR/conformance remain separate work. The DevTools example uses a real kit backend without presenting the DevTools UI.
