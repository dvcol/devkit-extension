# Independent server dependency reproduction

This corrects the isolation claim in the [original declaration probe](../server-type-compatibility/README.md). The old lockfile omitted cac even though a dependency extension requested it. Devframe declares cac as an optional peer, and pnpm did not install it through that extension. Ancestor scratch dependencies let the old compiler checks resolve cac anyway.

The corrected package explicitly depends on `cac@7.0.0`. Only the whenexpr metadata correction remains in the Devframe package extension. The three declaration patches are unchanged. All original snapshots remain in the old probe directory.

The new fixture was installed once to generate its lockfile, then copied into a second independent temporary directory and installed with `--frozen-lockfile`. Both directories are outside any ancestor containing `node_modules`; the replay checks this condition before type checking. In particular, `/private/tmp` on the investigation machine contained an unrelated `node_modules`, so the reproduction used the system temporary directory instead.

Copy this directory into a new directory whose ancestors contain no `node_modules`, then run:

```sh
pnpm install --frozen-lockfile --ignore-scripts --registry=https://registry.npmjs.org
node check.mjs
```

`check-isolation.mjs`, imported by the main check, verifies actual package resolution stays inside the fixture. It includes Devframe's own resolution of cac and whenexpr. `isolation.json` records the observed paths; `install-log.txt` records the successful frozen install. The 50 installed packages come from the pinned public graph and local declaration patches. No workspace package links or private registry credentials are used.

All five compiler configurations in `results.json` pass with strict TypeScript 7.0.2 and `skipLibCheck: false`. They cover the original imports, augmented preview/browser declarations, real kit/hub composition types, the extra strict optional/index/override flags, and the same checks with `ESNext.Error`. `h3-runtime-optionals.json` again confirms the four present undefined error properties.

This is declaration and dependency evidence. It does not validate a new runtime adapter, authentication flow or connection-isolation patch, and it does not make repository pnpm patches propagate to external package consumers.
