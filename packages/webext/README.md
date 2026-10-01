# @devkit/webext

A native Devframe channel for an already admitted WebExtension `runtime.Port`. The structural Port type accepts Chrome or Firefox objects without a browser polyfill or global browser lookup. Portable provider/catalog composition uses the shared [`@devkit/devframe`](../devframe/README.md) adapter and [`@devkit/client`](../client/README.md) router.

```ts
import { createPortChannel } from '@devkit/webext';
import { createRpcClient } from 'devframe/rpc/client';

const port = chrome.runtime.connect({ name: 'example' });
const connection = createRpcClient(localFunctions, {
  channel: createPortChannel({
    port,
    onDisconnect: () => connection.$close(),
  }),
});

// The owner closes both resources when its UI is disposed.
connection.$close();
port.disconnect();
```

The same channel object works with native `createRpcServer().updateChannels()`. The owner must admit incoming Ports before adding them, using the actual browser sender and the allowed extension pages or content scripts. The channel does not authenticate a page or choose recipients.

Devframe owns request IDs, responses, errors and value serialization. Its records serializer carries values such as Map and BigInt through Chrome JSON messages or Firefox structured clone. Unsupported values reject through the native serializer. `onDisconnect` closes the native RPC connection so waiting calls reject. Native `off` removes both Port listeners. Closing the RPC connection does not implicitly disconnect the caller-owned Port, cancel remote side effects, reconnect, reroute or replay work.

The package uses the existing public serializer and RPC channel type from the pinned Devframe release. Native shared-state and renderer integration uses the exact-version workspace backports from drafts [410](https://github.com/devframes/devframe/pull/410) and [411](https://github.com/devframes/devframe/pull/411).

`pnpm --filter @devkit/webext test` exercises native RPC over real MessageChannels with both JSON and structured-clone delivery. The [Chromium and Firefox example](../../examples/webext/README.md) imports the built package and exercises actual extension Ports. Its recorded scenarios establish those tested combinations; the complete API and browser-surface conformance inventory remains open.

The example's [declaration consumer tests](../../examples/webext/tests/declarations.test.ts) run with `pnpm --filter @devkit/example-webext test`. They run the pinned TypeScript 7 compiler against the built package exports and the example's installed `@types/chrome@0.3.0` and `@wxt-dev/browser@0.3.0` declarations. A temporary consumer under the example resolves those dependencies normally, with strict checking and `skipLibCheck: false`. It assigns both browser Port types to `RuntimePort` and `PortChannelOptions`, composes `PortChannel` with native client/server channels, and checks the exact compiler errors for incomplete Ports, options and channels. WXT generates its declarations from Chrome types; this is Chrome and WXT compatibility evidence, not independent Firefox-native declaration evidence. Build the package before running these tests.

`pnpm artifacts:native` also installs this package's tarball outside the workspace and composes it with the native provider and client packages. Strict declarations, real MessageChannel RPC and a browser bundle pass with the repository's explicitly installed patches. This does not establish unpatched publication compatibility.

The provider tests also exercise shared counter contracts, explicit selection, ambiguity, broadcast, catalog disable/enable, replacement and independent connections. Provider integration adds no runtime dependency to this channel package; the host composes the shared native adapter alongside it.
