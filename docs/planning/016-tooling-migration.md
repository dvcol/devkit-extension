# Strict Oxlint and Oxfmt migration

Owner requirement recorded on 2026-09-23 for [Release and conformance contract](https://github.com/dvcol/devkit-extension/issues/16). Implement this during monorepo foundation work, before admitting production SDK packages and maintained examples. Release checks retain the same gates. This document records required work; the old scaffold has not been migrated yet.

The tools are **Oxlint** for lint rules and **Oxfmt**, package `oxfmt`, for formatting. Commit their configuration and enforce it in local package scripts, staged-file hooks and CI. The formatter uses explicit formatting settings and a failing `--check` gate, not an invented lint-style strict preset. [Oxlint configuration](https://oxc.rs/docs/guide/usage/linter/config.html), [Oxfmt usage](https://oxc.rs/docs/guide/usage/formatter.html).

## Existing integration points to replace

| Current location | Required migration |
| --- | --- |
| Root `package.json` and lockfile | Replace ESLint, Stylelint, Prettier and their directly configured presets/plugins with current compatible pinned Oxlint/Oxfmt tooling; refresh resolved dependencies |
| `eslint.config.js`, `stylelint.config.js`, `prettier.config.js` | Remove legacy configuration after committing the new shared lint/format configuration and explicit ignore scope |
| `lint`, `lint:fix`, `style`, `style:fix` scripts | Use Oxlint check/fix and Oxfmt check/write commands; remove or deliberately replace obsolete script names and update their callers |
| `lint-staged.config.js` and `.husky` hooks | Invoke the same new tools against eligible changed files; remove legacy and stale framework commands |
| `.github/workflows/build.yml` and other workflows | Replace legacy version reporting and command invocations; fail CI on lint findings or formatting differences |
| Workspace/package/example scripts and editor settings | Resolve the committed shared configuration consistently; avoid a package silently falling back to default lint rules or another formatter |

The current scaffold still lists `@dvcol/eslint-config`, `@dvcol/stylelint-plugin-presets`, `@prettier/plugin-xml`, `eslint`, `eslint-plugin-format`, `eslint-plugin-vuejs-accessibility`, `prettier` and `stylelint`. This inventory is a starting point; migration must inspect all active callers rather than delete a fixed name list and assume the work is complete.

## Strict enforcement contract

- Enable correctness, suspicious and pedantic lint categories as errors, then explicitly configure relevant TypeScript, import, promise, test and maintainability rules. Record narrowly justified exceptions; do not weaken whole packages merely to make migration pass.
- Enable and verify supported type-aware linting against the selected TypeScript 7 pipeline. A compatibility failure is explicit adoption work, not permission to silently replace the configured check with default Oxlint.
- Fail checks on warnings and formatting drift. Apply one reviewed Oxfmt configuration across source, configuration and supported documentation formats; distinguish intentional generated/vendor exclusions from maintained source.
- Preserve the project's coding conventions, including descriptive identifiers, no IIFEs, exact Vitest assertion counts and no coverage-ignore patches. Identify what is enforced by rules and what still needs type checks or review; do not claim a rule covers behavior it cannot check.
- Oxlint and Oxfmt have different responsibilities. Formatting CSS does not establish all former Stylelint semantic checks. When replacing the old frontend scaffold, remove obsolete rules; any relevant constraint for retained renderer/example assets must have an explicit supported check or documented review obligation.
- Keep conventional-commit validation if still used. Commit-message linting is a separate responsibility from replacing source linters and the formatter.

## Completion gates

- [ ] Current compatible tool versions, actual CLI flags and TypeScript/type-aware integration are verified and pinned with the lockfile.
- [ ] Shared Oxlint and Oxfmt configurations express the enforced rules/settings and justified exceptions.
- [ ] Maintained packages, examples, scripts, hooks, editor settings and CI invoke those configurations; obsolete legacy invocations/configurations/direct dependencies are removed.
- [ ] A scoped negative check proves a configured lint violation fails, a warning cannot pass, and formatter check rejects formatting drift. Type checks remain independently enforced.
- [ ] All affected maintained files pass the new configured lint and formatting checks plus type checks. Local validation stays package-scoped; full repository checks run in CI.
- [ ] A dependency/caller audit distinguishes legacy tools still actively invoked from unrelated transitive package names and Oxlint's valid `eslint/...` rule identifiers.
- [ ] The implementation commit and CI evidence are linked from the owning ticket. Until then, migration remains incomplete.

The earlier core declaration fixtures used explicitly selected strict Oxlint categories. The server feasibility probes used default Oxlint and preserve exact executed evidence. Neither proves the monorepo migration or the eventual maintained-example lint preset. If a probe becomes a maintained example, migrate and rerun it under the shared configuration before counting it toward conformance.
