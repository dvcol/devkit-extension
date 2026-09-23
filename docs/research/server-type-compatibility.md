# Strict TypeScript 7 for the server adapter

A maintained server adapter can retain full declaration checking. A clean, frozen-lock installation of the current public packages passes TypeScript 7.0.2 after three narrowly scoped declaration patches, a whenexpr dependency metadata correction and an explicitly installed cac peer. No `skipLibCheck`, ambient `any`, native-context cast or replacement RPC implementation was used. This resolves the bounded declaration feasibility question; issue 6's adapter lifecycle and backend-reset policy remain separate decisions.

**Correction, 2026-09-23:** The original replay directory was nested beneath earlier scratch dependencies. Its lockfile never installed cac: pnpm omitted the added dependency because Devframe already declares cac as an optional peer. An ancestor installation masked that omission, so the original results did not prove independent installation. The [corrected reproduction](../probes/server-dependency-isolation/README.md) installs cac explicitly and verifies that every ancestor lacks `node_modules`. All five checks pass again. Original result and lock snapshots remain preserved as historical evidence.

The public package versions checked on 2026-09-23 remain `devframe` and `@devframes/hub` 1.0.0, `@vitejs/devtools-kit` and `@vitejs/devtools` 0.7.5, `crossws` 0.4.12 and `h3` 2.0.1-rc.32. No newer released fix was available in those packages. The executed reproduction pins Vite 8.3.0, TypeScript 7.0.2 and Node types 26.6.2. [Version evidence](../probes/server-type-compatibility/latest-versions.json), [Devframe metadata](https://registry.npmjs.org/devframe/1.0.0), [kit metadata](https://registry.npmjs.org/@vitejs%2fdevtools-kit/0.7.5).

## What failed and why

The original preview lockfile reproduced the recorded six imports-only diagnostics and ten augmented-registry diagnostics. The extra four appear only when Devframe's shared-state registry is augmented. The fixture that uses a real kit context exposes one additional missing type dependency. Turning on the monorepo's exact-optional-property rule then exposes a separate H3 declaration mismatch. [Original baseline](../probes/server-type-compatibility/baseline-original.txt), [augmented result](../probes/server-type-compatibility/augmented-original.txt).

| Finding                                    | Cause in the published artifact                                                                                                                                                                                                                                                            | Minimal tested remedy                                                                                                                                   | Upstream owner                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Four Bun/Cloudflare diagnostics            | `crossws/dist/index.d.mts` imports aggregate `WSOptions`; `_chunks/_types.d.mts` imports Bun/Cloudflare adapter options, whose declarations require runtime-specific development dependencies. Both Devframe's WebSocket declaration and H3's root declaration import this aggregate root. | Add a type-only common-types export to crossws; point only those two declaration imports at it. The existing common adapter types are reused unchanged. | crossws export; Devframe and H3 declaration import paths       |
| Missing `cac`                              | Devframe's shared context declaration imports `CAC` even when no CLI adapter is selected. Its published manifest marks cac as an optional peer.                                                                                                                                            | Install cac 7.0.0 explicitly to satisfy the published optional peer. The dependency extension did not install this peer.                                | Devframe dependency metadata or separation of CLI declarations |
| Four `TS2536` scoped-state errors          | Node and browser scoped-state overloads constrain a key with `keyof ScopedSharedStates<NS> & string`; TS7 rejects indexing that mapped type after registry augmentation.                                                                                                                   | Replace that constraint with `Extract<keyof ScopedSharedStates<NS>, string>` in the two published declarations, preserving the indexed result types.    | Devframe scoped node/browser declarations                      |
| H3 `TS4113` on `Error.isError`             | `static override isError` assumes the global Error constructor has the newer method; ES2023's library does not declare it.                                                                                                                                                                 | Remove only the declaration's `override` keyword. This also passes with `ESNext.Error` present and `noImplicitOverride: true`.                          | H3 declaration compatibility                                   |
| Missing `whenexpr` through kit             | `devframe/dist/utils/when.d.mts` imports `WhenExpression` from whenexpr, while the published package puts whenexpr only in development dependencies.                                                                                                                                       | Add whenexpr 0.1.2 through a Devframe package extension.                                                                                                | Devframe declaration bundling or dependency metadata           |
| H3 `TS2420` with exact optional properties | `HTTPError` implements `ErrorBody` but creates `statusText`, `unhandled`, `data` and `body` properties whose values can be undefined; `ErrorBody`'s optional properties exclude present undefined values.                                                                                  | Add `\| undefined` only to those four optional interface properties.                                                                                    | H3 ErrorBody declaration                                       |

The relevant artifacts are [crossws 0.4.12](https://registry.npmjs.org/crossws/-/crossws-0.4.12.tgz), [Devframe 1.0.0](https://registry.npmjs.org/devframe/-/devframe-1.0.0.tgz), [H3 rc.32](https://registry.npmjs.org/h3/-/h3-2.0.1-rc.32.tgz) and [kit 0.7.5](https://registry.npmjs.org/@vitejs/devtools-kit/-/devtools-kit-0.7.5.tgz). Exact tested diffs are preserved as [crossws.patch](../probes/server-type-compatibility/patches/crossws.patch), [devframe.patch](../probes/server-type-compatibility/patches/devframe.patch) and [h3.patch](../probes/server-type-compatibility/patches/h3.patch).

Adding `ESNext.Error` alone removed H3's original override error, but leaves the unrelated failures. Removing the declaration modifier supports the existing ES2023 library baseline. Both configurations were tested. No claim about support for every JavaScript runtime follows from that declaration check.

The H3 optional-property change reflects executed behavior: `new HTTPError({status:500})` has all four own properties with undefined values. It preserves `implements ErrorBody` rather than deleting the relationship. [Runtime observation](../probes/server-type-compatibility/h3-runtime-optionals.json).

## Smaller public imports help, within their actual scope

With cac installed and the declaration patches absent, these independent imports produced the following results. They use unaugmented registries and the original ES2023 configuration; they do not include the strict fixture's extra exact-optional check. [Executed entry-point results](../probes/server-type-compatibility/entry-point-results.json).

| Public import                                     | Result           | Implication                                                                                       |
| ------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| `DevframeNodeContext` from `devframe/types`       | Pass             | The adapter's contract can depend on this context without pulling in transport construction.      |
| `DevframeHubContext` from `@devframes/hub/node`   | Pass             | Installing into an existing hub context can use this public boundary.                             |
| `DevframeRpcClient` from `devframe/client`        | Pass             | The unaugmented client context avoids the transport constructor's aggregate types.                |
| `HubInstance` from `@devframes/hub/initiate`      | Five diagnostics | Actual hub construction still reaches crossws's runtime-specific options and H3's Error override. |
| `KitNodeContext` from `@vitejs/devtools-kit/node` | Six diagnostics  | Kit's public declaration graph additionally exposes the missing whenexpr import.                  |

Changing only Devframe's WebSocket type import to derive hooks from the public Node adapter did not remove the crossws failures: H3 still imported crossws's root. Avoiding `initHub` in an adapter-only package is legitimate when the embedding application owns it, but it does not satisfy the requirement for strict runnable host examples or a genuine kit context. Keep the narrow context import where appropriate and fix the complete example graph rather than claiming an imports-only pass proves host conformance.

## Reproducible patch proposal

The test adds a public **type-only** export in the locally patched crossws package:

```json
{
  "exports": {
    "./types": { "types": "./dist/_chunks/adapter.d.mts" }
  }
}
```

This is an additive fragment; all original exports remain. Devframe and H3 declarations then import their existing `Hooks`, `Peer` and `Message` types through `crossws/types`. This subpath is proposed by the local patch and is not a released upstream API. Consumers do not import a private chunk directly. A maintained patch must remain tied to the exact package version and be removed when an equivalent upstream release is verified.

The tested package-manager configuration is:

```yaml
patchedDependencies:
  devframe@1.0.0: patches/devframe.patch
  crossws@0.4.12: patches/crossws.patch
  h3@2.0.1-rc.32: patches/h3.patch
packageExtensions:
  devframe@1.0.0:
    dependencies:
      whenexpr: 0.1.2
```

The consuming server or reproduction package also declares `"cac": "7.0.0"` in `dependencies`. The precise changes are declaration and metadata changes. All runtime JavaScript compared byte-for-byte against the original installed packages: 86 Devframe files, 28 crossws files and 22 H3 files matched. Existing upstream `any` declarations remain unchanged; the proposal adds none. [Runtime comparison](../probes/server-type-compatibility/runtime-hashes.json), [locked patch hashes](../probes/server-type-compatibility/pnpm-lock.yaml).

To reproduce, copy [the corrected evidence directory](../probes/server-dependency-isolation/README.md) into a fresh directory outside the workspace and run:

```sh
pnpm install --frozen-lockfile --ignore-scripts --registry=https://registry.npmjs.org
node check.mjs
```

The corrected frozen-lock replay installs into a separate directory with no ancestor `node_modules`. Its isolation gate verifies real resolution of Devframe, hub, kit, TypeScript, cac and whenexpr beneath its own installed dependency directory. It uses the package-manager patch mechanism, rather than hand-edited dependency files. `check.mjs` runs these five checks and records each exit code:

| Configuration                       | Evidence                                                                                                             | Result |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------ |
| `tsconfig.baseline.json`            | Original native imports-only baseline                                                                                | Pass   |
| `tsconfig.json`                     | Original complete preview/browser probe source, including registry augmentation                                      | Pass   |
| `tsconfig.kit.json`                 | Public `createKitContext`, genuine `KitNodeContext`, public `DevframeHost`, real `PreviewServer` types and `initHub` | Pass   |
| `tsconfig.strict.json`              | Exact optional properties, checked index access, `noImplicitOverride`, kit composition and scoped state inference    | Pass   |
| `tsconfig.strict-esnext-error.json` | Same strict fixture with `ESNext.Error` included                                                                     | Pass   |

Every configuration has `strict: true` and `skipLibCheck: false`. The scoped fixture verifies numeric values inferred from a namespaced registry on both node and browser contexts. Two expected compiler errors reject assigning those values to strings. This checks the proposed constraint fix without removing the upstream API's existing generic fallback overload. [Corrected independent compiler results](../probes/server-dependency-isolation/results.json), [scoped fixture](../probes/server-type-compatibility/scoped-typecheck.ts).

## Adoption boundary

The proposal is feasible for the exact tested package graph. The private implementation workspace subsequently adopted the three declaration patches, the whenexpr extension and the server's explicit cac dependency. No neighboring Devframe/DevTools source checkout was modified, and no upstream PR was opened. Source inspection still found the published scoped constraint form in the local Devframe checkout; the report relies on published artifacts and the clean installed reproduction for its conclusions.

The next maintained server package should use the narrow public context types, preserve these full declaration gates and either adopt reviewed exact-version patches or consume verified upstream fixes. The whenexpr extension belongs with Devframe; cac must be satisfied explicitly as its existing optional peer. Neither check may rely on dependencies outside the tested installation. Published downstream adapters would still need to define how their consumers receive the fixes; a repository-level pnpm patch is not automatically propagated to external consumers.

This investigation did not execute a new DevTools UI, browser connection, authenticated endpoint, HMR cycle or backend restart. It did not type-check the entire `@vitejs/devtools` root package or every optional integration. The maintained adapter still needs its runtime and lifecycle tests, and the pending owner choice about automatic whole-backend restart remains pending.
