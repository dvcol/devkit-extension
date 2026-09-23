# Two-connection isolation evidence

On 2026-09-23, the released Devframe client reproduced two forms of shared browser state between independent connections. Explicit descriptors separate endpoint selection and ordinary calls, but the default authorization broadcast can still replace another connection's retained credential. This is evidence for the server adapter and provider-routing contracts; it does not settle routing policy.

## Executed topology

The [final baseline source](./baseline/probe.ts) builds a browser page with Vite 8.3.0 and serves it from an actual `PreviewServer`. One Node 26.9.0 process creates two real `initHub` instances on separate URL bases of that HTTP server. Each has a separate `createHubContext`, counter, shared state, storage directory and `createInteractiveAuth` handler with a distinct generated static token. `getDevToolsRpcClient` is used for one browser connection. This exercises its published wrapper; it does not construct a `KitNodeContext`, Vite DevTools UI or extension host.

The browser was the in-app browser, reporting Chrome `152.0.0.0` in its user agent. These results are not the selected current-stable Chromium/Firefox conformance matrix. No existing user browser profile, native computer control, extension debugging session, remote service or company context was used.

Dependencies came from the existing frozen server-type reproduction: `devframe@1.0.0`, `@devframes/hub@1.0.0`, `@vitejs/devtools-kit@0.7.5`, Vite 8.3.0, TypeScript 7.0.2 and Node types 26.6.2. The reproduction's declaration/metadata patches leave runtime JavaScript unchanged, as recorded in its [hash comparison](../server-type-compatibility/runtime-hashes.json). No packages were installed or upgraded for this probe.

## What actually happened

The [final result](./baseline/result.json) records independent browser observations and Node handler receipts. Its `passed: true` means the specified assertions passed, including reproduction of the undesirable shared-state behavior.

| Case | Observed result |
| --- | --- |
| Different `baseURL` values alone | After connecting to A, a second client requesting B inherited A's metadata. Its increment changed A from 1 to 3. B stayed at 0. The second call intentionally retained A's credential to observe endpoint selection independently of authorization rejection. |
| Explicit `connection` for A and `connectionMeta` for B | Calls reached A and B separately, with A at 7 and B at 10. Each server receipt identified its endpoint and matched that endpoint's static credential. Their shared-state values were separately observed. |
| A exchanges a freshly requested authorization code | A's public `connection.authToken` changed to its issued token. B's public connection then retained that same token, despite starting with a different static token. Token values were compared in memory; results retain only booleans. |
| B's existing connection after the broadcast | Its receipt still identified B and the original static credential. Continued success on an already trusted connection concealed the changed reconnect credential. A's new receipt correctly identified an issued credential. |
| Fresh B client from B's inherited descriptor | The new client became `unauthorized`. Its attempted increment by 100 rejected, and B's Node handler count remained exactly 2 before and after. The call did not mutate B. |
| Fresh B client with an explicit original token override | Authentication and a B receipt succeeded again. |
| Close A while B remains open | A's later call rejected with the native connection error. B stayed connected and incremented to 15. Both browser clients subsequently reached `disconnected`. |
| Cleanup | Both hubs' asynchronous close calls completed, the preview server stopped listening, no cleanup errors were recorded, and the owning runner exited 0. |

The browser's long-lived state subscription belonged to the original B connection. In the final OTP run, its recorded array is `[0, 10]`; the restored B client's value of 15 was separately checked through `observeState` and its server receipt. Do not label the old subscription as surviving reconnection.

This confirms that **explicit initial connection metadata is insufficient for full multi-connection authorization isolation**. A bounded proposed upstream fix can be evaluated separately; the released API must not be described as already isolated.

## Evidence history

- [Sandbox attempt](./attempts/sandbox-attempt.json): loopback listen failed with `EPERM`; the approved isolated launch subsequently succeeded. This was an execution-environment restriction.
- [Initial successful run](./attempts/initial-run/result.json): endpoint/static-token/state/close cases, before adding code exchange. Its exact TypeScript sources are alongside the result.
- [Metadata guard failure](./attempts/metadata-guard-failure/result.json): the probe incorrectly required optional `jsonSerializableMethods`. The real metadata contained only `backend` and `websocket.path`. The fixture guard was corrected; no upstream runtime change was made.
- [First successful OTP run](./attempts/otp-run/result.json): reproduced the authorization/recreation case before final function extraction for strict lint.
- [Final baseline](./baseline/result.json): repeated all scenarios after those source changes, using the retained final source.

Historical snapshots preserve the code that produced their results. They retain their original style/type-check limitations and are not maintained example packages. The final baseline passes full declaration checking with `skipLibCheck: false`, exact optional properties, checked indexed access, strict type-aware Oxlint with warnings denied, and Oxfmt. [Validation record](./validation.json).

## Reproduce

Prepare the [existing server-type reproduction](../server-type-compatibility/README.md) in a disposable directory using its exact lockfile and patches. Copy `baseline` to a separate disposable directory, link its `node_modules` to that reproduction's installed dependencies, then run:

```sh
node node_modules/typescript/bin/tsc --noEmit
node probe.ts
```

For the strict lint check, add the implementation workspace's `node_modules/.bin` to `PATH` so Oxlint can locate `tsgolint`, then run `oxlint --config <implementation>/.oxlintrc.json --type-aware --deny-warnings <probe>/*.ts`. Using only the absolute Oxlint binary can fail its companion-executable lookup. The placeholders denote the implementation checkout and disposable probe directory.

The runner prints a loopback URL. Open it once in an isolated browser tab; the page executes the assertions automatically and posts a sanitized report. The Node runner independently verifies receipts, writes `result.json`, closes its hubs and preview, and exits. A browser page that never starts leaves the runner waiting; stop that owned process explicitly if abandoning a reproduction. Observation deadlines bound individual expected transitions; they are not cleanup proof.

Only the probe's own page should use its control endpoints. They deliver freshly generated test credentials and the requested one-time code over its owned loopback origin. These endpoints are test machinery, not a proposed SDK authentication API.

Generated credentials, one-time codes, auth storage, browser storage, `node_modules`, built assets, running-process files and raw network captures are excluded from this evidence bundle. The source creates new credentials on each launch. Results retain endpoint labels, credential categories, equality booleans and counts. `SHA256SUMS` inventories the retained files.

## Source basis and limits

The behavior follows the released client at `devframe/dist/client/index.mjs`: stored connection reuse before `baseURL` discovery around lines 483–529; token persistence and broadcast around 1912–1934; shared authorization channel consumption around 1996–1998. The released interactive auth handler permits existing trusted sessions before considering a new handshake token. The probe reaches these through public `devframe/client`, `devframe/recipes/interactive-auth`, `@devframes/hub/node` and `@devframes/hub/initiate` APIs. [Released Devframe artifact](https://registry.npmjs.org/devframe/-/devframe-1.0.0.tgz), [released hub artifact](https://registry.npmjs.org/@devframes/hub/-/hub-1.0.0.tgz), [released kit artifact](https://registry.npmjs.org/@vitejs/devtools-kit/-/devtools-kit-0.7.5.tgz).

No SDK discovery registry, routing directive, provider identity policy, cancellation protocol, renderer or cross-browser extension implementation was added. The experiment does not prove two independent Node processes, separate browser origins, credential revocation, recovery after process termination, CDB integration, or permission UI behavior. Those remain separate work.
