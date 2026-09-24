# Connection isolation follow-up, 2026-09-24

The released complete Devframe client still has no supported option to isolate its connection cache or authentication broadcasts. A small dependency patch is a practical way to continue the private monorepo implementation. The SDK should own its connections, enable the patch's opt-in on each one, and keep provider-specific credentials in that connection owner. Publishing an SDK whose consumers need this behavior still requires an upstream release, an explicitly maintained fork, or a documented consumer-level dependency patch.

## Fresh checks

- `pnpm view devframe dist-tags version --json --registry=https://registry.npmjs.org` reports latest `1.0.0`.
- GitHub's current `devframes/devframe` main points at `18fa60effeb928eb445add2a536cd44906a59981`, committed 2026-09-17T02:42:20Z.
- Current source still has unconditional `new BroadcastChannel('devframe-auth')` in `packages/devframe/src/client/rpc.ts:431`, token persistence at lines 487 onward, and broadcast consumption at lines 617 onward. Current `connection.ts:28` exposes only connection, connectionMeta, baseURL and authToken options. The source downloads named in `upstream-status.json` were inspected in the original temporary investigation directory. Permanent source references are [connection.ts](https://github.com/devframes/devframe/blob/18fa60effeb928eb445add2a536cd44906a59981/packages/devframe/src/client/connection.ts) and [rpc.ts](https://github.com/devframes/devframe/blob/18fa60effeb928eb445add2a536cd44906a59981/packages/devframe/src/client/rpc.ts).
- Public GitHub searches for `isolateConnection`, `isolation`, `authentication`, and `connection cache` found no adopted isolation option. This is a bounded search, not a guarantee about every upstream branch. Related merged PR #386 only disposes channels and trust deadlines: https://github.com/devframes/devframe/pull/386.
- The existing proposal patch applied with zero fuzz to a disposable copy of this workspace's currently locked, declaration-repaired `devframe@1.0.0`. The copied fixture passed 8 Vitest tests, strict TypeScript 7 checking, and type-aware Oxlint with warnings denied.
- Verification directory: `/private/var/folders/4y/5mvy0qfx6yd8z1lllg4_n5340000gp/T/devframe-isolation-verification-81DjG3`. Its `preparation.json` records actual input/output hashes. No installed package or repo file was changed.
- Fresh real-browser replay could not start because `cua.createBrowserTab('iab', ...)` returned `Browser is not available: iab`. No tab was created and no native permission was requested. The owned runner received an explicit failure report through its test endpoint so both hubs and preview completed their normal disposal. Exit 1 accurately records the skipped browser run. A subsequent HTTP request was refused. `baseline/result.json` records zero handler calls and successful cleanup. The previous checked-in browser results remain historical evidence; no new browser success is claimed.

## Why a supported wrapper is insufficient today

The high-level client calls `setupDevframeConnection()` internally. Even explicit `connection` and `authToken` values write global connection metadata and token storage. Explicit values separate initial dialing, but every full client then creates the same authentication BroadcastChannel. A successful code exchange in A broadcasts its token; B calls its own `requestTrustWithToken()` with that token and replaces its retained credential before checking the server's result.

`simpleAuth: false` only suppresses the native prompt. `otpParam: false` only suppresses URL OTP consumption. `cacheOptions: false` controls RPC response caching. `wsOptions`, `sseOptions` and `rpcOptions` have no auth-channel or connection-cache ownership option. The channel is private to the high-level client. `close()` closes the complete client, including its transport.

A wrapper which restores globals, replaces BroadcastChannel, or monkeypatches client methods would depend on private execution details and create races with unrelated clients. Retaining a second immutable token for reconnect can mask one symptom but does not prevent the live client from consuming unrelated auth updates.

`devframe/rpc/client` and `devframe/rpc/transports/ws-client` are public and avoid the high-level cache themselves. They expose bare birpc plus a channel. They do not return a complete DevframeRpcClient, and the high-level constructor cannot accept an injected channel or low-level client. Its connection status, trust bootstrap, pending-call guards, service catalog and shared-state client assembly use private functions. Rebuilding those would duplicate upstream lifecycle/auth/state behavior. The shared-state host and service catalog assembly functions are not exported from `devframe/client`.

## Exact transitional patch

The [retained proposal](../patch-verification/devframe-1.0.0-isolate-connection.patch) changes `dist/client/index.mjs` and `dist/client/index.d.mts` only:

1. Add `isolateConnection?: boolean` to SetupDevframeConnectionOptions, inherited by DevframeRpcClientOptions.
2. Under true, use explicit or fetched metadata and explicit metadata credentials. Skip shared connection/token cache reads and writes.
3. Under true, create no authentication BroadcastChannel, so neither publication nor consumption occurs.
4. Keep token updates and OTP exchange on the current client. Preserve the existing full RPC, authentication, state, services and transport implementation.
5. Preserve omitted/false behavior.

Its source equivalent belongs in `packages/devframe/src/client/connection.ts` and `rpc.ts`, with upstream tests and generated declarations. It adds no server protocol or competing transport.

The private monorepo already declares `devframe@1.0.0` in `pnpm-workspace.yaml` patchedDependencies. Its current patch changes declarations only. The runtime-isolation hunks can be added to the same patch, then pnpm can regenerate the patch hash/lock. The fresh copied-package verification above proves the two sets of changes compose at the file level. An actual workspace frozen install and affected integration checks remain required after adoption.

Example wrapper after adopting the patch, not an API available from the unpatched release:

```ts
const client = await getDevToolsRpcClient({
  connection: providerConnection,
  isolateConnection: true,
  otpParam: false,
  simpleAuth: false,
  webmcp: false,
});
```

The SDK connection owner retains `client.connection` after authorized credential updates and passes it explicitly when recreating that provider's connection. The owner closes only the clients it created. Shared cross-tab token propagation stops for these isolated clients, so any desired persistence or sharing must become an explicit provider-scoped policy. Credentials never enter public discovery snapshots.

## Transitive clients and prebuilt assets

The option must be enabled at every SDK-owned full-client construction. Merely installing the patch leaves native defaults unchanged.

| Native API | Available integration path |
| --- | --- |
| getDevToolsRpcClient | Forwards all caller options to getDevframeRpcClient, then forces simpleAuth false. It can forward the new flag without a wrapper patch. |
| connectRemoteDevframe / connectRemoteDevTools | Forwards caller options and supplies URL-derived connection metadata and token. It can forward the flag. |
| createDevframeClientRuntime | Accepts an existing rpc or connect options. Supply the SDK-owned client. It still publishes a singleton hub UI context, so this is not an instruction to mount one complete native UI runtime per provider in the same document. |
| @devframes/hub-ui embedded and standalone bootstrap | Calls getDevframeRpcClient without the flag. The published JS assets contain an inlined client and unconditional auth channel. Changing the devframe package does not rewrite these prebuilt assets. |

The checked-in mixed browser replay used a shared/default A beside isolated B and proved that B retained its own token and authenticated on recreation. Thus upstream default clients can coexist with an isolated SDK client in that tested topology. This does not make those default clients isolated from each other, and it does not prove every native UI profile.

## Distribution choices

| Choice | Practical consequence |
| --- | --- |
| Existing root pnpm patch, recommended for private development | Keeps exact reviewed upstream implementation and deterministic lock, permits ongoing SDK-owned client work, requires carrying the patch until an upstream release. A downstream application's install does not automatically inherit this repository's root patchedDependencies. |
| Wait for upstream release | Avoids carrying a runtime fork but blocks full multi-server transport verification. Pure registry/selector and unrelated host work can continue. Opening an upstream PR still requires user approval. |
| Maintained fork or package containing patched implementation | Can distribute the fix independently, but adds release/version/license ownership. It should be a deliberate publication decision, not an accidental hidden copy. |
| Unpatched wrapper or bare-RPC reassembly | Wrapper lacks the needed ownership switch; bare-RPC reassembly duplicates high-level behavior. Neither is recommended. |
| Separate-origin documents | Could use browser storage/channel boundaries, but changes the application topology and introduces cross-context lifecycle, authentication and messaging. Not executed here and unnecessary if the narrow option is adopted. |

The owner decision, if required, is whether to carry this temporary runtime dependency patch now and pursue upstream separately. No architecture decision about selector precedence or broadcast syntax can fix this transport defect.

## Retained evidence

`validation.json` records the fresh disposable-package checks and the browser limitation. `source-evidence.json` records locked-package hashes and relevant snippets, including the independently bundled native UI clients. `upstream-status.json` records the registry and upstream revision check. `baseline/result.json` preserves the failed browser attempt and completed cleanup. These files retain their original temporary paths as provenance. Earlier executable fixtures and successful browser evidence remain in the parent proposal directory; this follow-up does not replace their dates or results.
