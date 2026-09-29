# CDB and native Devframe registration evidence

Frozen September 29, 2026 investigation for [the integration report](../../research/cdb-devframe-integration.md). This is an isolated registration-boundary reproduction, not a maintained browser example.

`reconnect-probe.mjs` uses the released CDB client/connection plus the installed public Devframe collector and scoped-client implementation. Every transport method throws if called. The receipt records a same-peer duplicate-registration failure and passing distinct-peer/direct-client controls, along with exact imported file paths and hashes. The retained parent replay used Node 26.9.0; an earlier independent run used Node 24.20.0 with the same results.

`released-package.json` and `metadata.json` identify `@dvcol/cdb-devframe@0.3.0`. `source-provenance.json` records source-map hashes and equality with the inspected local CDB files. `SHA256SUMS` covers all retained inputs and outputs. No dependency archive, generated bundle or installed modules are committed.

To reproduce in a disposable directory:

1. Obtain the exact archive URL and integrity from the retained release metadata, verify it, and extract it into `package/`.
2. Link `node_modules/@dvcol/cdb-devframe` to that extracted package. Link `node_modules/@dvcol/cdb` to the maintained debugger example's installed core CDB and `node_modules/devframe` to the maintained server package's installed Devframe. This deliberately tests the actual existing workspace patches. It is not an isolated fresh-install acceptance test.
3. Copy `reconnect-probe.mjs` and run it with Node 24 or newer. It writes `reconnect-receipt.json`. The printed native `DF0021` is the expected reproduced defect; all assertions must still pass.

The source is frozen research outside maintained TypeScript/Oxlint gates. Its actual collector rejects duplicate registration; its fake peer does not simulate authentication, sockets or browser behavior. Do not use its passing exit status as evidence that same-peer reconnect works.
