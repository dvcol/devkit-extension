# @devkit/webext

A native Devframe channel for an already admitted WebExtension `runtime.Port`. The structural Port type accepts Chrome or Firefox objects without a browser polyfill or global browser lookup. This first package slice contains the channel binding; portable provider/catalog composition is still pending.

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

`pnpm --filter @devkit/webext test` exercises native RPC over real MessageChannels with both JSON and structured-clone delivery. The [Chromium example](../../examples/webext/README.md) imports the built package and exercises actual extension Ports. Firefox browser execution is still required before claiming Firefox conformance.
