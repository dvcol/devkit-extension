# Single-object declaration probe

Compile-only proposal executed on 2026-09-24 against the built core and contribution example exports. The exact TypeScript source tests an action implementation declared as one object containing `contract`, `execution`, `requires` and `handler`, plus a service declared as one object containing `capability`, `execution` and `setup`.

Strict TypeScript 7 checking passes. Four `@ts-expect-error` cases reject an unknown action input property, undeclared dependency, invalid capability input and wrongly typed service input. This establishes the tested contextual inference, not a complete declaration implementation or all generic-union cases. Current production helpers still take their original arguments.

The executed source retains absolute checkout paths as provenance. The successful command was `pnpm exec tsc --ignoreConfig --noEmit --strict --skipLibCheck false --target ES2023 --module ESNext --moduleResolution Bundler --lib ES2023,DOM /private/tmp/devkit-single-object-factories.ts`. The initial invocation omitted `--ignoreConfig` and stopped with TS5112 before checking the fixture; rerunning with the explicit flag passed. Adapt the source path and imported checkout paths to repeat elsewhere.
