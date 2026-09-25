# Server dependency patches

These exact-version patches let the private server integration retain TypeScript 7's full declaration checks, including `skipLibCheck: false`, exact optional properties and registry augmentation. They reproduce the [executed compatibility investigation](../docs/research/server-type-compatibility.md). The crossws and h3 changes affect declarations only. The Devframe patch also contains the explicitly adopted client connection isolation change described below.

| Package          | Correction                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `crossws@0.4.12` | Add a type-only `crossws/types` export for the existing common adapter declarations so Node consumers do not import Bun and Cloudflare option types.                                 |
| `devframe@1.0.0` | Import common hooks from that type-only export. Use `Extract` for scoped registry key constraints while preserving indexed node/browser state types.                                 |
| `h3@2.0.1-rc.32` | Import common WebSocket types from that export. Support the ES2023 Error constructor declaration and describe the four optional error fields that can have present undefined values. |

The Devframe package extension supplies its missing declaration dependency on `whenexpr@0.1.2`. The server package explicitly installs `cac@7.0.0` to satisfy Devframe's published optional peer, which its context declarations import unconditionally. Adding cac through `packageExtensions.dependencies` did not install that existing optional peer and must not substitute for the explicit dependency. Neither correction adds an adapter implementation or changes RPC behavior.

Keep these fixes tied to their reviewed versions and remove them when compatible upstream releases pass the same declaration checks. The added `crossws/types` export is a local patch, not a released upstream API. Repository pnpm patches do not automatically reach consumers of a published adapter. External distribution still needs an upstream fix or an explicit consumer installation policy before the server package can claim standalone compatibility.

## Devframe connection isolation

The exact-version `devframe@1.0.0` patch includes the runtime change from [Devframe draft 401](https://github.com/devframes/devframe/pull/401), currently reviewed at [6d66d7e9](https://github.com/devframes/devframe/commit/6d66d7e9abea9a1f5fa23abb9567671f36437db9). `connection.isolated` bypasses shared connection discovery, stored browser credentials and authentication broadcasts. The prepared descriptor retains that setting across token updates and reuse. Shared behavior remains the default.

```ts
const connection = await setupDevframeConnection({
  baseURL: 'http://localhost:5173/',
  connection: { isolated: true },
});
const client = await connectDevframe({ connection });
```

The maintained [installed-package tests](../packages/server/tests/connection-isolation.test.ts) and [negative type fixtures](../packages/server/tests/connection-isolation.type-test.ts) guard this backport alongside the native server tests. Patching this dependency does not rewrite prebundled upstream UI assets with their own embedded client.

[Vite draft 23574](https://github.com/vitejs/vite/pull/23574) is separate. No Vite dependency patch is installed; the accepted exceptional restart-cleanup gap remains. Both upstream PRs remain drafts for the repository owner to take over.
