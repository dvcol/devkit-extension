# Vite candidate cleanup: upstream suitability

Issue [13](https://github.com/dvcol/devkit-extension/issues/13), investigated on 2026-09-24. The executed fixture imports only Node builtins and Vite, with `devtools: false`. No SDK, Devframe or DevTools code is involved. This directory preserves executed evidence; it adopts no Vite patch and opens no Vite PR.

## Finding

A normal Vite plugin creates a timer in `configureServer` and disposes it in `closeServer`. During restart, Vite prepares the replacement before closing the old generation. If old cleanup rejects, stock Vite abandons the prepared replacement without invoking its close lifecycle. Its filesystem watcher and plugin timer remain active.

| Before manual fixture cleanup | Stock Vite 8.3.0 | Disposable candidate-close patch |
| --- | --- | --- |
| Candidate close hook | Never called | Called once |
| Candidate filesystem watcher | Open, observes another real file edit | Closed |
| Candidate plugin timer | Active | Cleared |
| Original restart error | Rejected or logged | Preserved |
| Watched-config process | Continues | Continues |
| Filesystem watcher error events | None | None |

Both programmatic restart and a real watched config edit reproduce the issue. The watched case has no application catch around restart or process error handler. Vite catches and logs that failure itself, so throwing does not necessarily kill the process. A filesystem watcher error listener cannot receive this lifecycle rejection.

`plain-stock-result.json` and `plain-patched-result.json` retain the actual observations. Both final runs exit successfully and clean up their temporary resources. `validation.json` also records the fixture's initial watcher-startup race and its correction; the resource assertions do not depend on a sleep interval.

## Upstream fit

The public [`closeServer` hook](https://vite.dev/guide/api-plugin#closeserver) owns cleanup of resources created in `configureServer`. The installed 8.3.0 runtime equals the official npm tarball, whose integrity was checked. At investigation time npm latest was 8.3.0. Official main at `e8990c4d6101dfaca2654ed8ab4d0574ee920248` retains the [unfenced old shutdown](https://github.com/vitejs/vite/blob/e8990c4d6101dfaca2654ed8ab4d0574ee920248/packages/vite/src/node/server/index.ts#L1425). Main was inspected, not built or tested.

The hook's introduction in [PR 23110](https://github.com/vitejs/vite/pull/23110) already discussed thrown cleanup errors. A [maintainer accepted keeping config-watch logging distinct from CLI failure](https://github.com/vitejs/vite/pull/23110#issuecomment-5176196499). A suitable fix should preserve that policy and close only the abandoned candidate. Merged [PR 23165](https://github.com/vitejs/vite/pull/23165) provides a related cleanup-after-failure precedent.

The proposed source patch awaits candidate `close()` if old shutdown rejects, then rethrows the original error. If candidate cleanup also rejects, it retains both errors. It adds no recovery, retry, supervisor, hook or automatic restart. The error aggregation shape remains an upstream review detail.

Three bounded searches found no exact duplicate. [Issue 23493](https://github.com/vitejs/vite/issues/23493) concerns references retained after successful restarts; [draft PR 23159](https://github.com/vitejs/vite/pull/23159) concerns process exit. Neither handles this caught config-update failure.

## Alternatives

| Alternative | Consequence |
| --- | --- |
| Catch and log the plugin's cleanup failure | Allows replacement despite unproven old cleanup, changing the accepted ownership behavior |
| Listen for watcher errors | No event is emitted for a rejected close hook |
| Use a `configureServer` return callback | That callback runs after middleware setup; it is not a disposer |
| Track every candidate or wrap restart in consumer code | Duplicates Vite ownership and does not naturally cover its internal config watcher |
| Exit the process on failed cleanup | Valid for an owning CLI, but an embedding SDK cannot impose process termination |
| Leave the case documented and restart manually | Avoids a dependency patch; leaves the resource leak until process exit |

An independent plugin has no supported hook that hands it the abandoned candidate after old cleanup fails. A small upstream ownership fix therefore benefits ordinary consumers. The SDK can continue ordinary development/HMR/build-watch work without adopting it, while retaining this failed-restart case as an open limitation.

## Reproduce and limits

```sh
node plain-vite-restart.mjs /absolute/path/to/vite/dist/node/index.js
node plain-vite-restart.mjs /absolute/path/to/disposable-patched-vite/dist/node/index.js fixed
```

`upstream-source-proposal.patch` targets the inspected main. The executed patch was applied only to a disposable copy of the pinned runtime; upstream source build/type/lint gates have not run. Existing native-host probes separately cover simultaneous old-cleanup and candidate-cleanup failures.

Before a Vite PR, add focused regression tests to `packages/vite/src/node/__tests__/plugins/hooks.spec.ts` for candidate disposal, awaited cleanup, original failure identity, dual failure and successful restart. Validate against upstream source and repeat the real watched-config case. Third-party cleanup may itself reject or hang; the fix cannot guarantee resource disposal. Failed candidate construction/listening and general hook error aggregation remain outside its scope.
