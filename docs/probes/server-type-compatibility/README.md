# Strict public server declaration compatibility

Executed on 2026-09-23 with Node 26.9.0, pnpm 12.5.1 and TypeScript 7.0.2. This is research evidence for issue 6, not an implemented server adapter or an accepted upstream patch.

The original preview dependency lock reproduced six imports-only errors and ten with registry augmentation. `baseline-original.txt` and `augmented-original.txt` preserve those diagnostics. `entry-point-results.json` tests narrower public imports after installing the declared optional cac peer, before applying declaration patches.

The package-manager patches and dependency extensions in this directory were applied through a fresh install and then replayed in a separate directory with `--frozen-lockfile`. All five checks in `results.json` passed with `skipLibCheck: false`. The strict checks additionally enable exact optional properties, checked index access and `noImplicitOverride`; the fifth includes `ESNext.Error` as well as ES2023.

```sh
pnpm install --frozen-lockfile --ignore-scripts --registry=https://registry.npmjs.org
node check.mjs
```

Run this directory independently, or copy its files into a fresh directory outside the monorepo before installing. Its lockfile and patched dependency hashes are part of the evidence. `check.mjs` runs only these compiler fixtures and the bounded H3 constructor check. It does not run the historical preview server/browser probe. The copied `probe.ts` and `browser-client.ts` are inputs for declaration checking.

`h3-runtime-optionals.json` records an actual `HTTPError({status:500})`: statusText, unhandled, data and body are own properties whose values are undefined. This supports the corrected exact-optional declaration. `runtime-hashes.json` records byte-identical JavaScript across the original and patched devframe, crossws and h3 packages, covering 86, 28 and 22 files respectively. The patches change declarations and one type-only package export.

See [the research report](../../research/server-type-compatibility.md) for root causes, exact remedies, upstream ownership and remaining limits. The probe is preserved as executed and is outside the maintained workspace lint preset.
