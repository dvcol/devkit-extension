# Tooling conventions

The workspace uses TypeScript 7, Vite, Oxlint with its TypeScript Go integration, and Oxfmt. Root tool versions are exact pins. The lockfile resolves every workspace dependency. The existing seven-day release-age and provenance downgrade policies remain enabled, so the selected Oxc and Turbo versions are the newest stable releases allowed by those policies on 2026-09-23. Package updates must pass the same checks before changing the pins.

## Commands and ownership

| Scope              | Command                                       | Behavior                                                                                           |
| ------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| One package        | `pnpm --filter @devkit/core lint`             | Explicit shared Oxlint config, type-aware rules, warnings rejected                                 |
| One package        | `pnpm --filter @devkit/core typecheck`        | Independent TypeScript 7 check including tests and config                                          |
| One package        | `pnpm --filter @devkit/core build`            | Vite library bundle and TypeScript declarations                                                    |
| One package        | `pnpm --filter @devkit/core test`             | Vitest tests; a missing test suite fails                                                           |
| One package        | `pnpm --filter @devkit/core format:check`     | Shared Oxfmt check                                                                                 |
| Repository tooling | `pnpm tooling:lint`, `pnpm tooling:typecheck` | Only root configuration and scripts                                                                |
| Gate proof         | `pnpm tooling:test`                           | Positive control and deliberately failing lint, warnings, typed lint, compiler and format fixtures |
| Changed files      | `pnpm exec oxfmt --write <paths>`             | Apply shared formatting                                                                            |
| CI                 | `pnpm ci`                                     | Full workspace builds, independent types, lint, formatting and tests                               |

Keep local checks scoped to affected workspaces. Turbo orders dependencies before dependent builds and checks; packages declare actual dependencies using `workspace:*`. The root TypeScript project includes only tooling files. Each package owns its source/test TypeScript project, allowing type-aware Oxlint to discover real types without one root project loading every package.

`lint-staged` checks eligible staged files without applying source changes. Both source lint and formatting must pass. The commit-message hook uses Commitlint independently. VS Code recommends the Oxc extension, enables its formatter and type-aware linting, and uses the same committed config.

## Enforced rules and exceptions

`.oxlintrc.json` enables correctness, suspicious and pedantic categories as errors. Explicit rules also enforce type-only imports, unsafe-value checks, handled promises, import cycles and duplicates, exact equality, non-nested ternaries, function complexity and nesting limits, and test assertion declarations. `options.typeAware` activates `oxlint-tsgolint`; `maxWarnings: 0` and CLI `--deny-warnings` reject warnings. Unused lint-disable directives are errors. TypeScript independently checks the project with `skipLibCheck: false`, exact optional properties and checked index access.

| Exception                                    | Scope          | Reason                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript/prefer-readonly-parameter-types` | All source     | Standard Schema infers consumer input types; native `AbortSignal` and provider handles retain upstream types. Owned registries also require mutation. Deep readonly rewriting would change the accepted API or require repeated casts. Declaration data remains explicitly readonly where the API promises it. |
| `vitest/max-expects`                         | `**/*.test.ts` | One lifecycle scenario can require several observations. Splitting those observations would hide the sequence being tested. Exact `expect.assertions(N)` remains required.                                                                                                                                     |
| `eslint/max-lines-per-function`              | `**/*.test.ts` | Test setup and lifecycle sequences can be longer than production functions. Complexity and nesting rules still apply; production function-length checks remain enabled.                                                                                                                                        |

Descriptive variable and generic names, no IIFEs, JSDoc placement, no multiline ternaries, direct styled Node logging, and no coverage-ignore patches remain review obligations where the installed rules do not fully express them. In particular, Vitest's assertion rule permits `expect.hasAssertions()` and cannot verify the exact runtime count. This repository requires `expect.assertions(N)` with the correct count; reviewers and executed tests enforce that additional requirement. Do not claim Oxlint checks it completely. `unicorn/prevent-abbreviations` is not available in the pinned Oxlint rule set and is not configured as a fictitious rule.

The old Vue UI, its CSS and its Stylelint rules were removed. Future renderer and host examples must state any required CSS semantics, accessibility and browser constraints with their own relevant checks. Oxfmt's CSS support only checks formatting.

## Preserved research evidence

`docs/probes/**` and `docs/contracts/**` are preserved research artifacts, not maintained workspace packages. Their exact executed files have their own recorded validation and are excluded from the new lint and formatting gates. `docs/planning/**` retains historical review formatting. Canonical architecture and glossary documents, new maintained documentation, packages and examples use Oxfmt.

Generated `dist`, coverage and the pnpm lockfile are excluded from formatting. The lockfile is produced and checked by pnpm, not reformatted by a separate tool. Generated bundles and coverage are excluded from lint. No maintained package or example is excluded wholesale. Promoting a research probe to an example requires moving it into `examples/*`, applying the shared toolchain and rerunning its proof.

## Enforcement proof

`scripts/check-enforcement.ts` creates temporary TypeScript fixtures and removes them afterward. It verifies a valid source passes, an equality violation fails, the same rule as a warning still fails, a floating promise triggers type-aware lint, a type mismatch fails the independent compiler, and formatting drift fails until Oxfmt repairs it. Diagnostics are checked for the intended rule or compiler code so an unrelated crash cannot satisfy a negative case.

The implementation replaces direct legacy source-linter/formatter dependencies, configuration, staged hooks and CI callers. Oxlint rule IDs containing `eslint/` are built into Oxlint and do not mean ESLint is installed or invoked. Conventional-commit linting remains separate. The template's publishing and deployment workflows were removed because they targeted the former application; release automation is still owned by issue 16.

Sources: [Oxlint configuration](https://oxc.rs/docs/guide/usage/linter/config.html), [type-aware linting](https://oxc.rs/docs/guide/usage/linter/type-aware.html), [Oxfmt configuration](https://oxc.rs/docs/guide/usage/formatter/config.html), [pnpm configuration migration](https://github.com/pnpm/pnpm.io/blob/main/docs/migration.md).
