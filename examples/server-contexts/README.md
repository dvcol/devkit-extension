# Native server context examples

This package runs the same counter capability and action in a real `DevframeHubContext` and a real `KitNodeContext`. It imports the unchanged contracts from `@devkit/example-contribution`. Both hosts install the same service and action plugin through `@devkit/server`.

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

The example registers two explicit methods for the **host lifetime**. The increase method captures its provider once, checks the expected incarnation, and calls the existing contribution. The pending query demonstrates ordinary native handler behavior across disconnect. Neither definition is advertised as an agent tool. This is an explicit host composition, not automatic remote publication of installed plugins.

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
| Invalid input                                     | Native schema validation rejects before a counter change.                                     |
| Provider disposal                                 | Its action rejects; unrelated HTTP still returns `host-alive`.                                |
| Same-ID provider replacement                      | The old incarnation rejects; a fresh call returns `7`, using retained native state.           |
| Actual native host shutdown during a pending call | The channel closes the native RPC client and the pending client call rejects.                 |
| Already-started server handler after disconnect   | Releasing its gate still lets it finish. Client rejection does not prove server cancellation. |
| Host-owned declaration count                      | The two methods remain registered across provider replacement; no names accumulate.           |

The low-level native client needs its `$close()` connected to the channel's disconnect/error callbacks. The example does that directly, with no additional request-ID registry or RPC codec. The native high-level browser client already owns its own connection guards. A five-second native RPC timeout bounds failed calls in this executable example; it is not a server-side cancellation mechanism.

The [native lifecycle investigation](../../docs/research/native-rpc-lifecycle.md) records missing coherent dynamic RPC removal and server-side ordinary-call cancellation through an existing hub. The owner has since selected host-owned remote methods, which avoids requiring dynamic removal. The combined startup API remains under review, and this example does not implement the general remote adapter or backend cancellation.

## Scope

The local demos are headless in-process integrations; `demo:remote` adds real authenticated WebSocket calls. Neither implements remote SDK catalog synchronization/discovery, a DevTools UI, Vite HMR, a JSON renderer, or browser extension execution. The kit context has no Vite server in this example. Browser-hosted examples and reload behavior remain separate work.
