# Opt-in connection isolation prototype

This is a proposal against released `devframe@1.0.0`, not an accepted SDK contract or an upstream API. The patch changes two published client artifacts. It preserves the current behavior when the option is omitted or false.

```ts
const client = await connectDevframe({
  connection: { connectionMeta, metaBaseUrl },
  authToken,
  isolateConnection: true,
  otpParam: false,
  simpleAuth: false,
  webmcp: false,
});
```

`isolateConnection?: boolean` belongs to `SetupDevframeConnectionOptions`, which the complete client options extend. It controls only shared connection discovery and credential effects:

| Operation | Default behavior | `isolateConnection: true` |
| --- | --- | --- |
| Initial metadata | Explicit descriptor, cached connection, then `baseURL` fetch | Explicit descriptor, then `baseURL` fetch |
| Initial credentials | Explicit credentials, then shared token lookup | Explicit credentials or fetched metadata credentials |
| Publish connection or token | Global connection/meta/token properties and localStorage | No shared cache reads or writes |
| Explicit token update | Persist token and update this client's token | Update this client's token |
| Successful OTP exchange | Update this client, persist, and broadcast | Update this client only |
| Other client's auth broadcast | Receive and apply shared token | No authentication BroadcastChannel exists |
| RPC, shared state, services, lifecycle | Existing complete client | Same complete client |

The prototype leaves URL OTP consumption and prompt behavior under their existing options. The replay explicitly disables both. It does not add a credential store, choose adapter policy, or change server authentication. A caller can retain `client.connection` and explicitly supply it when recreating that provider's client.

## Reproduce the narrow verification

Use a separately installed copy of the frozen `docs/probes/server-type-compatibility` fixture. Its README contains the frozen installation command. The monorepo must already have its pinned development tools installed. Preparation performs no installation and changes neither input directory.

From the monorepo root, set `frozen_fixture` to that installed fixture:

```sh
repository_root="$PWD"
frozen_fixture="/absolute/path/to/installed-server-type-fixture"
verification_sources="$repository_root/docs/probes/provider-connection-isolation/proposal/patch-verification"
verification_root=$(node "$verification_sources/prepare.mjs" "$frozen_fixture" "$repository_root")
cd "$verification_root"
export PATH="$verification_root/node_modules/.bin:$PATH"

./node_modules/.bin/vitest run --config vitest.config.ts
./node_modules/.bin/tsc --noEmit -p tsconfig.json
./node_modules/.bin/oxlint --config "$repository_root/.oxlintrc.json" --type-aware --deny-warnings isolation.test.ts isolation.type-test.ts vitest.config.ts prepare.mjs
./node_modules/.bin/oxfmt --config "$repository_root/.oxfmtrc.json" --check isolation.test.ts isolation.type-test.ts vitest.config.ts prepare.mjs tsconfig.json
node --check devframe/dist/client/index.mjs
```

`prepare.mjs` checks the two source hashes, creates a fresh temporary directory, copies the dependency, applies the exact patch with zero fuzz, and copies the tests/configuration. It links existing dependency and tooling directories into that copy. The optional `cac` peer needs an explicit link after copying a package out of pnpm's dependency tree; preparation resolves it from the installed source package. The frozen fixture's package extension supplies it. There is no application-level global patching.

`preparation.json` in the generated directory records the patch output and actual input/output hashes. `hashes.json` records the expected pristine and declaration-repaired variants. The published JavaScript is identical in both inputs. Their declaration difference is the earlier `keyof ... & string` to `Extract<...>` repair in the scoped shared-state signature. That repair is absent from this isolation patch, which applies to either variant without fuzz. Strict declaration verification uses the repaired fixture because the original package has the previously recorded TypeScript failures.

## Evidence and limits

Eight runtime tests cover explicit metadata, explicit connections, fetched metadata despite a conflicting cached provider, shared-cache reads/writes, local token updates, no isolated auth channel, and omitted/false default behavior. Two expected-error fixtures enforce the boolean option on setup and complete client options. `validation.json` records the scoped successful commands.

The unit tests replace browser I/O at the test boundary. They do not prove live authentication or transport behavior. The separate `../replay` evidence uses real browser clients, two authenticated hubs, real OTP exchange, actions and shared state. It covers default behavior, two isolated clients, and a shared client alongside an isolated client. The application uses only the proposed option and public APIs.

No upstream source checkout, application dependency declaration, or package publication was changed.
