# Vite source regression and reviewable proposal

Issue [13](https://github.com/dvcol/devkit-extension/issues/13), 2026-09-24. This is an isolated upstream proposal. The SDK continues using unpatched Vite and accepts the failed-restart cleanup gap.

The patch changes two files: 13 additional runtime lines in the existing restart failure path, plus two regression cases in the existing lifecycle suite. When closing the previous server rejects, await replacement disposal and rethrow the original error. If disposal also rejects, retain both errors in an AggregateError. Successful restart, hook ordering, watcher events, logging and retry behavior are unchanged.

## Validation

- Both new cases fail on upstream base because the replacement never closes.
- All 26 lifecycle hook cases pass with the fix, including successful restart and ordinary close behavior.
- Tests verify the replacement watcher closes, asynchronous cleanup is awaited, the original error retains identity, and a second cleanup failure remains observable.
- Scoped Vite build, declaration checks, package typecheck, changed-file ESLint and Oxfmt pass.
- The built-source replay proves programmatic restart and actual watched-config failure close the replacement watcher and plugin timer. Vite still logs watched failures and keeps the process alive.

`validation.json` records exact base/proposal commits; `proposal.patch` is the complete reviewable diff. The patch is not registered in pnpm and no Vite dependency bytes were changed in this monorepo. This evidence does not claim full Vite CI or recovery when candidate cleanup itself hangs or fails.

## Upstream draft

The owner explicitly authorized publication using the reviewed short description. [Vite draft PR 23574](https://github.com/vitejs/vite/pull/23574) is open at `301d422cd05e2f4ce4a29fc6d01de39936c282f2`, rebased onto upstream `39ddf7ccf7e7469ff6a3ba37bca38c32ea804d6e`. All 26 hook tests, the scoped package build/typecheck and changed-file lint pass again after rebasing. GitHub rejected self-assignment for this account; the draft itself was created successfully.

The stored patch, red/green receipts and validation JSON preserve the original executed base/proposal pair. Their pre-publication status is historical. The workspace continues using unpatched Vite; SDK work does not depend on upstream acceptance.
