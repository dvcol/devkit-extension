# Native Port investigation

The working fixture now lives in [examples/webext](../../../examples/webext/README.md). It uses the maintained `@devkit/webext` package and installed native dependency backports, with strict workspace checks and an automated real-Chromium test. An upstream checkout is no longer required.

The original prototype source and receipt remain in [3fb91fd](https://github.com/dvcol/devkit-extension/tree/3fb91fd/docs/probes/native-port). The native changes were separated into [RPC/state draft 410](https://github.com/devframes/devframe/pull/410), [JSON renderer/view draft 411](https://github.com/devframes/devframe/pull/411), and independent [snapshot repair 412](https://github.com/devframes/devframe/pull/412).
