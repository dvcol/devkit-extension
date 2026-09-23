# Toolchain audit evidence

These are retained inputs and outputs of the bounded experiments described in [the report](../toolchain-reload.md), captured on 2026-09-22 (Asia/Tokyo). They are research fixtures, not SDK examples or a production scaffold.

- `release-metadata.json` records the registry snapshot and artifact integrity values.
- `probe-results.json` records command argument lists, fixture-relative working directories, and exit codes for the scripted compiler/build/lint/unit-test batch. Later browser and Turbo checks have separate logs/results; they are not represented by that batch.
- `browser-results.json`, `firefox-results.json`, and `wxt-development-results.json` contain measured browser outputs. Their corresponding logs and `probe/*.mjs` contain the executed assertions.
- Final build/lint/test logs coexist with initial failed fixture attempts and deliberate negative controls. Read the report for the distinction; not every nonzero exit represents a tool incompatibility.
- `turbo-scoped-final.log` is an explicitly marked excerpt. Repeated registry DNS failures were removed; the initial context and final failing task result remain. Turbo orchestration did not pass.
- `manifests/` contains generated manifests from the successful builds, plus the measured Chromium development manifest. These are fixture manifests, not publication-ready extension manifests.
- `probe/` contains the final authored inputs and lockfiles. The initial generator is omitted because its output was subsequently corrected. The `@types/node` manifest selector was `latest`; the saved lockfile resolves `26.6.2`. All reported tool candidates were explicitly pinned.

Absolute personal/worktree/temp paths in text were replaced with `<USER_HOME>`, `<PROBE_ROOT>`, `<RESEARCH_ROOT>`, `<RESEARCH_WORKTREE>`, or `<TEMP_PATH>`. ANSI terminal escape sequences were removed. No test result was changed. System application paths, public package registry URLs, generic example identifiers, localhost URLs, and the disposable extension ID remain.

Dependencies, browser binaries/profiles, stores, caches, generated implementation bundles, and SDK package tarballs are excluded. Rebuild/package the synthetic SDK before installing its consumer. Follow the report's ordered commands from `probe/`; this is not a claim of a fully automated one-command reproduction. The isolated root installation used `--ignore-workspace`, and the later workspace/Turbo attempt failed; the saved workspace graph is not a verified monorepo configuration.

The Firefox script uses `/Applications/Firefox.app/Contents/MacOS/firefox`; adjust the binary path on other systems. Browser profiles created by the scripts are disposable and contain only fixture activity.
