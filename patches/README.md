# Server dependency declarations

These exact-version patches let the private server integration retain TypeScript 7's full declaration checks, including `skipLibCheck: false`, exact optional properties and registry augmentation. They reproduce the [executed compatibility investigation](../docs/research/server-type-compatibility.md). Runtime JavaScript is unchanged.

| Package          | Correction                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `crossws@0.4.12` | Add a type-only `crossws/types` export for the existing common adapter declarations so Node consumers do not import Bun and Cloudflare option types.                                 |
| `devframe@1.0.0` | Import common hooks from that type-only export. Use `Extract` for scoped registry key constraints while preserving indexed node/browser state types.                                 |
| `h3@2.0.1-rc.32` | Import common WebSocket types from that export. Support the ES2023 Error constructor declaration and describe the four optional error fields that can have present undefined values. |

The Devframe package extension supplies its missing declaration dependency on `whenexpr@0.1.2`. The server package explicitly installs `cac@7.0.0` to satisfy Devframe's published optional peer, which its context declarations import unconditionally. Adding cac through `packageExtensions.dependencies` did not install that existing optional peer and must not substitute for the explicit dependency. Neither correction adds an adapter implementation or changes RPC behavior.

Keep these fixes tied to their reviewed versions and remove them when compatible upstream releases pass the same declaration checks. The added `crossws/types` export is a local patch, not a released upstream API. Repository pnpm patches do not automatically reach consumers of a published adapter. External distribution still needs an upstream fix or an explicit consumer installation policy before the server package can claim standalone compatibility.
