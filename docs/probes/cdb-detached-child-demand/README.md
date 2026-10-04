# Native detached-child demand cleanup

This retains the source equivalent of the installed CDB cleanup fix for [Debugger and CDB contract](https://github.com/dvcol/devkit-extension/issues/10). It is a prepared candidate, not a published upstream PR.

When Chrome emits `Target.detachedFromTarget`, the publisher removes the child session and its domain-demand set. Subsequent subscription disposal asks to deactivate the old demand. The released publisher checks whether the session exists before checking whether there is anything left to deactivate, so native cleanup rejects needlessly.

```text
Chrome child detach
  → native publisher removes child session and demand
  → subscription disposal requests active:false for old child
  → existing no-op check sees no demand
  → return without a Chrome command
```

The [source patch](./source.patch) moves the existing child lookup below the existing demand/no-op check, adding and removing two lines. Method validation still runs first. Activating demand on the removed child still rejects. Live-child disable and native error wrapping stay unchanged. No SDK target, routing or lifecycle API changes.

The [four native regressions](./tests.patch) reproduce two failures and two passing controls on current original upstream `4053273d`. All four pass on the candidate. [Combined validation](./validation.json) links the actual 106-test extension package result, changed-file native lint, source and test-inclusive TypeScript checks and build, run with the independent worker candidate also present. The installed fix already passes the maintained actual Chromium child-removal checks through both native backends.

For replay, apply `source.patch` and `tests.patch` from a clean matching native checkout. Run `pnpm --filter @dvcol/cdb-extension test`, the package typecheck and native ESLint on the two changed files. The two cleanup cases should fail if only the test patch is applied. Preserve the native pinned graph and verification policy. Full upstream checks belong to CI.

The [prepared draft description](./upstream-draft.md) includes reproduction steps. Publishing requires owner approval. Prompt settlement of already-running child commands, nested/worker contexts and child Fetch interception remain separate native acceptance work.
