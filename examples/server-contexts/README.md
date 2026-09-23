# Headless server context examples

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
pnpm --filter @devkit/example-server-contexts run test
```

Each demo prints its configured provider ID, adapter-issued incarnation, execution descriptor and actual native context availability. The first action and capability read return `3`. After disabling and enabling the service, the next action and native command return `7`. The incarnation stays unchanged across activation changes. Provider disposal removes the owned command while the native shared state still contains `7`. The runner then closes the host.

The executable check imports the built package exports and runs both paths, asserting these values and statuses. It exits unsuccessfully if either path fails. Each runner awaits host cleanup before its promise fulfills. It does not mock context construction, state, service calls, actions or cleanup.

```sh
pnpm --filter @devkit/example-server-contexts run typecheck
pnpm --filter @devkit/example-server-contexts run lint
pnpm --filter @devkit/example-server-contexts run format:check
```

## Scope

This is headless local integration. It does not run a DevTools UI, a remote client or router, Vite HMR, a JSON renderer, or browser extension execution. The kit context has no Vite server in this example. Browser-hosted examples and reload behavior remain separate work.
