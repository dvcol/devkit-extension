# Proposed upstream connection-isolation option

This is a bounded feasibility proposal for issue 6. It is not a released Devframe option, an adopted SDK API, or a change to the workspace's installed packages. The [released baseline](../README.md) remains separate under issue 7.

The candidate adds `isolateConnection: true` to the copied Devframe 1.0.0 client. Opted-in clients use supplied connection metadata and credentials without consuming or publishing the shared browser connection/token cache, and do not create the shared authorization broadcast channel. Ordinary RPC, state, authentication handlers and transport implementations remain upstream's existing code. The default shared behavior remains available.

## Browser replay

The [replay source](./replay/probe.ts) bundles `devframe/client` through Vite's exact-module alias to the separately copied candidate package. Server APIs and other dependencies still come from the unchanged released-package reproduction. Each mode ran in its own scratch directory, Node process, preview port and storage directory. Within each mode, two headless hubs share that mode's HTTP server and Node process. This is the same topology and proof boundary as the baseline, including the kit browser wrapper rather than a genuine DevTools host.

| Mode | Endpoint selection | After A's code exchange | Fresh B from its connection descriptor | Final counters and cleanup |
| --- | --- | --- | --- | --- |
| [Shared/default](./replay/results/shared.json) | Second `baseURL` inherits A | B's retained token changes to A's | Unauthorized; protected increment rejects; B handler count stays 2 → 2 | A 7, B 15 after explicit B token restoration; both hubs/preview close; exit 0 |
| [Both isolated](./replay/results/isolated.json) | Second `baseURL` reaches B | B retains its original token | Trusted; B receipt executes; handler count 3 → 4 | A 5, B 17; B still works after A closes; both hubs/preview close; exit 0 |
| [Shared A, isolated B](./replay/results/mixed.json) | B independently reaches B | B ignores the shared client's authorization update | Trusted; B receipt executes; handler count 3 → 4 | A 5, B 17; B still works after A closes; both hubs/preview close; exit 0 |

Different final counter values are intentional. With isolation, the first two calls mutate A by 1 and B by 2. Shared discovery sends both to A instead. Later operations and handler receipts verify those independent histories; the test does not reset counters to conceal misrouting.

For isolated B, the fixture observes token equality for a bounded 250 ms after A's completed exchange, then exercises the existing B session, closes it and authenticates a fresh B connection from its retained descriptor. The timer is an observation window, not cleanup or indefinite absence proof. Mixed mode matters because A still sends the ordinary shared update. Server receipts distinguish initial static credentials from A's legitimately issued credential, and no raw token or one-time code is retained.

The observed browser user agent is Chrome 152 in the in-app browser. Firefox, current-stable conformance, multiple browser origins, separate provider processes and extension transports were not exercised by this replay.

## Reproduction and validation

Prepare the existing [frozen dependency reproduction](../../server-type-compatibility/README.md). Apply the candidate patch only to a disposable copy of its Devframe package, with the copy's dependency resolution intact. The [patch verification](./patch-verification/README.md) contains the exact patch, input/output hashes, unit/declaration tests and reproduction instructions.

Copy `replay` into a new disposable directory, link its `node_modules` to the existing dependency reproduction and select the copied package with `PROBE_DEVFRAME_PACKAGE`:

```sh
PROBE_DEVFRAME_PACKAGE=/absolute/path/to/copied/devframe node probe.ts shared
PROBE_DEVFRAME_PACKAGE=/absolute/path/to/copied/devframe node probe.ts isolated
PROBE_DEVFRAME_PACKAGE=/absolute/path/to/copied/devframe node probe.ts mixed
```

Run each command separately, opening its printed URL once. Use separate probe directories when running modes concurrently. Each runner writes its own `result.json` and awaits actual hub/preview shutdown. The selected mode is also carried in the browser URL; do not remove that query parameter.

The browser fixture labels the new option explicitly as a research-only flag. Its strict TypeScript check uses the released declaration graph with a structurally wider options value; it does not prove that released declarations expose the option. Candidate declaration checks belong to `patch-verification`.

Final replay sources pass TypeScript 7 full declaration checking, strict type-aware Oxlint with warnings denied, and Oxfmt. The actual runner exit codes are all zero. The [validation record](./replay/validation.json) records commands and boundaries. Oxlint needs the implementation workspace's `node_modules/.bin` on `PATH` to locate `tsgolint`.

All three modes executed identical source files. After execution, only `probe.ts` received whitespace formatting. Its exact executed content is retained as [executed-probe.ts.txt](./replay/results/executed-probe.ts.txt), and [executed source hashes](./replay/results/executed-source-hashes.json) allow comparison. The other retained source files are byte-identical to those executed. No behavior changes followed the browser runs.

## Adoption boundary

These results support a small opt-in upstream change without replacing Devframe's RPC or authentication system. They do not authorize publishing that change, adopting the option in the SDK, or choosing provider identity/routing policy. Review the public option, ownership/documentation, full upstream regression coverage and release compatibility before adoption. No upstream PR was opened, no production package was patched, and no root lockfile changed.
