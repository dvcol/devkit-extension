# Devkit Extension

A framework-neutral contribution SDK for development-server and WebExtension providers. The monorepo is being rebuilt from the former Vue extension template. The settled [architecture](./ARCHITECTURE.md), [glossary](./GLOSSARY.md) and [implementation map](https://github.com/dvcol/devkit-extension/issues/1) define the intended behavior. Host adapters, renderer integrations and browser examples remain implementation work.

Use Node 24 or newer and the pnpm version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm --filter @devkit/core build
pnpm --filter @devkit/core typecheck
pnpm --filter @devkit/core lint
pnpm --filter @devkit/core test
pnpm --filter @devkit/core format:check
```

Packages live in `packages/*`, runnable host examples in `examples/*`. Vite builds JavaScript and TypeScript 7 emits declarations and checks source, tests and build configuration. Package builds must not import browser or server host dependencies into the portable core.

The [UI-free contribution example](./examples/contribution/README.md) runs a shared capability and action through the local provider lifecycle. It demonstrates separate contract/provider entry points, typed native context, dependency activation, schema validation and owned cleanup. Run it through built package exports:

```sh
pnpm --filter @devkit/example-contribution... run build
pnpm --filter @devkit/example-contribution run demo
```

The [core proof matrix](./docs/contracts/CORE-API-MATRIX.md) records local evidence and the remaining host obligations. A passing local lifecycle example does not complete the Devframe, DevTools, Chromium or Firefox integrations.

Oxlint checks correctness, suspicious and pedantic rules as errors, plus explicit TypeScript, imports, promises and test rules. Type-aware linting is enabled. Warnings fail checks. Oxfmt controls formatting, and `format:check` fails on drift. See [tooling conventions](./docs/TOOLING.md) for the enforced rules, documented exceptions and review obligations.

```sh
pnpm tooling:lint
pnpm tooling:typecheck
pnpm tooling:test
pnpm exec oxfmt --write path/to/changed-file.ts
pnpm exec oxfmt --check path/to/changed-file.ts
```

Keep local validation scoped to the changed package or dependency graph. `pnpm ci` is the full repository gate used by GitHub Actions. Historical probes under `docs/probes` preserve exact executed evidence and are separate from maintained packages and examples.

The previous template's publishing and deployment workflows have been removed. Package publishing, browser-store releases and example deployment will be established through the release contract in [issue 16](https://github.com/dvcol/devkit-extension/issues/16).
