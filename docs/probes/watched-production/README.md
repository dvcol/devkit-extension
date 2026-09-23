# Watched production output retention probe

The tested workflow works with a separate build watcher and Vite preview process. A failed build retains the last complete page only when the probe publishes complete generations outside Vite's working output directory. Vite writing directly into the served directory does not satisfy the requirement across all build failures.

This is a throwaway feasibility experiment for the Server adapter contract. It adds no SDK implementation and changes no repository or upstream package.

## Exact environment and commands

Observed on macOS arm64 with Node 26.9.0, pnpm 12.5.1, Vite 8.3.0, Rolldown 1.2.9, TypeScript 7.0.2, and Oxlint 1.85.0. `pnpm-lock.yaml` pins the installed artifacts and integrity values. `result.json` records the package-manager executable and user-agent from the executed script environment.

```json
{
  "build:watch": "node build-watch.ts",
  "preview": "node preview.ts",
  "dev:production": "pnpm --workspace-concurrency=2 run \"/^(build:watch|preview)$/\""
}
```

The final probe runs that exact `dev:production` script. Both underlying scripts remain independently runnable after fixture preparation. Preview owns the HTTP server; the watcher is a separate process. The earlier server-preview probe establishes that a live Devframe backend can attach to this HTTP lifecycle. This experiment does not combine or reset that backend.

For reproduction, copy the source/config files listed below into a fresh directory without `.runs` or `node_modules`, use the exact recorded Node/pnpm versions, then run:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm probe
```

`pnpm probe` prepares a tiny HTML/TypeScript/CSS fixture, runs the raw and publication scenarios, edits real watched source files, verifies HTTP responses, and closes the processes. Reproduction requires a fresh directory: this bounded controller does not support reusing a previous `.runs` directory. Source edits drive real watcher events; no build events are simulated.

## Observed results

`result.json` contains the HTTP response bodies, asset SHA-256 hashes, status responses, actual watcher event sequence, process IDs, and cleanup evidence.

| Actual source/build transition | Direct output serving | Complete generation publication |
| --- | --- | --- |
| Initial successful build | HTML and both assets return 200 | HTML and both assets return 200 |
| TypeScript syntax error | Previous page remains available | Exact previous HTML/JS/CSS remain available; status is failed |
| Syntax-error recovery | New complete page returns 200 | New complete generation returns 200 |
| Real plugin error in `generateBundle` | Page returns 404 | Exact previous HTML/JS/CSS remain available; status is failed |
| Late-error recovery | New complete page returns 200 | New complete generation returns 200 |
| Original asset URLs after later publication | Not asserted | Both still return 200 with their original hashes |

The intentional late error is raised by a real Vite plugin after output-directory preparation. It demonstrates a different failure stage from an early syntax error. Both are failed real watched builds. This does not claim coverage of every filesystem or plugin failure.

For each mode, the public watcher `close()` and `PreviewServer.close()` completed. The corresponding acknowledgement files were observed, both process IDs were absent, and the former HTTP endpoint refused connections. The controller uses an owned `SIGUSR2` handler to invoke those public handles before final process-group cleanup. The earlier SIGTERM experiment is not the final cleanup proof: Vite's own SIGTERM handler can exit before the probe writes its acknowledgement.

## What Vite provides and what the probe adds

Vite provides the actual watcher through `build({ build: { watch: {} } })`, build/plugin hooks, `preview()`, static file serving, and both close handles. Its installed 8.3.0 artifact runs `prepareOutDir` from a `renderStart` hook and resets that preparation on `watchChange`. With `emptyOutDir: true`, preparation empties existing output before later rendering/plugin work can fail. The relevant artifact locations are `dist/node/chunks/node.js:33614` for output preparation, `:34048` for watched builds, and `:35006` for preview. See the [pinned Vite package](https://registry.npmjs.org/vite/-/vite-8.3.0.tgz), [build options](https://vite.dev/config/build-options#build-emptyoutdir), and [public JavaScript API](https://vite.dev/guide/api-javascript).

The probe adds a separate staging directory and immutable generation directories. `writeBundle` copies completed output into a temporary generation directory and renames it. Only the real `BUNDLE_END` event advances the active generation through a same-directory temporary-file rename. Failed builds update status while retaining the previous generation reference. Preview exposes `/__build-status` and redirects the entry page to its generation-specific path; Vite serves the files. Relative asset URLs remain within that same generation, including for an older page opened before a newer publication.

This generation publication and routing behavior is ours, not a Vite guarantee. Setting `emptyOutDir: false` was not tested as an alternative and would not itself establish a complete-generation transaction across multiple file writes. No atomicity claim is made for crashes, cross-filesystem moves, Windows, competing publishers, arbitrary public paths, or continuous concurrent request load. Generation cleanup and application routing still need a production design.

The status evidence is a real JSON HTTP response. This does not prove a visible diagnostics panel, automatic page reload, HMR, state restoration, action/backend generation compatibility, or backend reset policy. Those remain distinct acceptance work.

## pnpm launcher evidence

The initial `pnpm run --parallel "/^(build:watch|preview)$/"` selected the watcher first and never reached preview. Finite two-script controls confirmed serial execution with that flag in this environment. Plain regex matching and explicit `--workspace-concurrency=2` without `--parallel` overlapped. The final full watcher/preview experiment uses the latter form successfully. `launcher-evidence.json` preserves the actual timestamp controls and command forms. The effective `workspace-concurrency` configuration query returned `undefined`; the executable reported version 12.5.1.

This is not a finding that pnpm lacks parallel regex support. The [pnpm run documentation](https://pnpm.io/cli/run#running-multiple-scripts) documents concurrent regex execution and distinguishes the cross-package `--parallel` flag. The cause of the flag interaction was not investigated further.

## Validation and files to preserve

`pnpm check` ran `tsc --noEmit` with `strict: true` and no `skipLibCheck`; it passed. `pnpm lint` ran exactly `oxlint *.ts` and passed using default rules. This is not conformance to a future strict repository preset. `pnpm probe` exited zero after both scenarios and the cleanup assertions.

Preserve `README.md`, `package.json`, `.npmrc`, `pnpm-lock.yaml`, `tsconfig.json`, `common.ts`, `build-watch.ts`, `preview.ts`, `controller.ts`, `result.json`, `launcher-evidence.json`, and `validation.json`. Preserve the small `launcher-test/package.json` and `launcher-test/step.mjs` to reproduce the finite command comparison. Generated `.runs*`, `node_modules`, and intermediate logs are unnecessary; the final `result.json` contains the relevant complete response evidence and event sequence.
