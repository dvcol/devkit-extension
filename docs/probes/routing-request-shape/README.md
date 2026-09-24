# Compact routed invocation typing

Compile-only proposal checked on 2026-09-24 with TypeScript 7.0.2 against the built core and shared counter entry files. No production API or callback/default placement is adopted by this probe.

One request object preserves capability operation-name inference, schema-derived input and return values, target-required versus targetless calls, action input types, and per-provider broadcast result values. Four positive assignments and eight `@ts-expect-error` assertions pass strict checking with declaration checking enabled. `validation.json` records the command and scope.

The exact executed source and config retain their absolute paths. Adapt those paths to repeat from another checkout. This does not prove transport behavior, dynamic operation-union correlation, package export-map enforcement or a packed consumer. A settled API will need maintained contract tests covering the full declaration shape.
