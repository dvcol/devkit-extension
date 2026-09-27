# Project boundaries

Read [ARCHITECTURE.md](./ARCHITECTURE.md#upstream-compatibility-and-minimal-adapters) before changing a public contract or adapter. Use Devframe's public APIs directly when they fit. New local mechanisms need a concrete missing behavior; do not recreate native auth, RPC, serialization, shared state, JSON rendering or Vite lifecycle.

The [upstream alignment review](./docs/research/upstream-alignment-review.md) records intentional SDK differences and current integration gaps. Preserve accepted routing and contribution lifecycle behavior when simplifying. Maintained package exports define the current API; declaration probes under `docs/contracts` are historical evidence.

Keep implementation commits scoped to their issue and update that issue with evidence. Validate the affected package or dependency graph locally; use CI for the full workspace. See [tooling conventions](./docs/TOOLING.md) for strict Oxlint, Oxfmt and TypeScript checks.
