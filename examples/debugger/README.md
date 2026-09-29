# Debugger contribution example

This private, UI-free example composes `@devkit/core` contribution definitions and the exported `@devkit/runtime` provider lifecycle with released `@dvcol/cdb@0.3.0` and `@dvcol/cdb-extension@0.3.0`. It runs an embedded bridge inside an extension background context. No daemon, WebSocket broker, renderer, or remote routing layer is required.

`src/contracts.ts` defines a page-title capability and action. Its input is CDB's own `{ id, generation }` target reference, validated against the released UUID/positive-generation shape. The service acquires an `exclusive-control` CDB lease, evaluates the fixed expression `document.title`, validates the result, and releases its lease. It never accepts an arbitrary expression from a contribution caller.

This is a **trusted in-process composition**. The host's `debug` capability level is broader than this action, and the embedded client is trusted. The example does not establish authenticated remote grants, a general debugger SDK contract, or an untrusted-page authorization boundary.

## Composition and ownership

The recipe uses the actual public native APIs:

| Piece                       | Owner and API                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| Background provider         | `createProviderLifecycle`, with a fresh incarnation and `webext` / `webext.background` context  |
| Native resource             | `defineNativeContext<EmbeddedChromeDebuggerBridge>`; remains local, outside action input/output |
| Target and attachment       | `createSelectedTabPublisher`; Chrome tab IDs remain inside this host                            |
| Chrome lifecycle forwarding | `createSelectedTabLifecycle.start()` / `.stop()`                                                |
| Commands and events         | CDB client leases, commands and subscriptions; CDB owns domain demand                           |
| Host teardown               | Stop forwarding, await publisher revocation, then dispose the embedded bridge                   |

`src/lifecycle.ts` adapts Chrome's `Tab.id` to CDB's required `tabId` and normalizes optional fields for strict TypeScript. Native debugger event payloads are checked at the JSON boundary; malformed payloads are reported to the host. The upstream lifecycle helper handles navigation updates, tab removal and debugger detachment. CDB's default metadata redaction remains in effect.

An embedding background context can use the source recipe as follows, after it has selected an authorized tab:

```ts
import {
  createDebuggerHost,
  installDebuggerContributions,
  readPageTitleAction,
} from './src/index.js';
import type { SelectedTab } from '@dvcol/cdb-extension';

async function readSelectedTitle(selectedTab: SelectedTab) {
  const host = createDebuggerHost('chromium', console.error);
  if (host.status !== 'available') throw new Error(host.reason);
  try {
    const { provider } = await installDebuggerContributions(host.bridge, console.error);
    try {
      const target = await host.publisher.publish(selectedTab);
      return await provider.invoke({
        action: readPageTitleAction,
        input: { id: target.id, generation: target.generation },
      });
    } finally {
      await provider.dispose();
    }
  } finally {
    await host.dispose();
  }
}
```

The one-shot snippet explicitly owns both lifetimes. A long-lived background host can keep the publisher and bridge alive across multiple contribution installations. Disposing contributions, a lease, a subscription, or the embedded client does not destroy that host. No teardown is tied to an extension document closing. The empty packaged `probe.html` only gives browser automation an extension-owned message sender; it is not an application frontend.

Disabling a service aborts its operation signal and forwards cancellation to `broker.cancelCommand`. The provider still waits for the native command to settle before cleanup completes; cancellation does not prove Chrome has stopped evaluating. There is no replay or automatic reattachment. Release after target revocation can reject through CDB's native authorization checks. Those failures are not suppressed. CDB's publisher catches native detach failures internally, so a resolved host disposal alone is not proof of physical detachment; the browser check also verifies that native commands fail afterward.

## Browser behavior

Chromium uses an MV3 service worker with required `debugger` and `tabs` permissions. Firefox receives a separate MV3 manifest without `debugger`; `createDebuggerHost('firefox', ...)` returns `{ status: 'unavailable', reason: 'unsupported-browser' }` before accessing Chrome debugger APIs. The portable action remains installed, its requirement waits, capability resolution is unavailable, and invocation rejects with the runtime's `unavailable-capability` result.

This package does not claim Firefox CDP parity, native DevTools coexistence, Fetch interception configuration, process recovery, HMR, or integration into a renderer. Those remain separate contract and host work.

## Run and verify

From the repository root, build the affected graph and run the package checks:

```sh
pnpm exec turbo run build --filter=@devkit/example-debugger...
pnpm --filter @devkit/example-debugger typecheck
pnpm --filter @devkit/example-debugger lint
pnpm --filter @devkit/example-debugger format:check
pnpm --filter @devkit/example-debugger test
pnpm --filter @devkit/example-debugger test:browser
pnpm --filter @devkit/example-debugger test:firefox
```

The Chromium command uses the installed Playwright Chromium channel in a temporary profile and serves an owned loopback target. The Firefox command uses Selenium/geckodriver in a temporary native profile; `FIREFOX_BINARY` can select its executable. Install these browser prerequisites through the repository's existing browser setup. Both runners close their owned browsers. Chromium also closes its HTTP server and removes its profile.

Build outputs are `dist/chromium/` and `dist/firefox/`. The former can be loaded unpacked through Chrome's extension developer page; the latter can be loaded temporarily through Firefox's add-on debugging page. There is no action/popup UI. Browser automation opens `probe.html` and starts the checks. Production package imports are bundled, and bundle tests reject Node externals or MCP implementation modules in either browser graph.

Nine Vitest cases cover ownership, native command failure and later success without replay, stale target references, invalid replies, delayed cancellation, native lifecycle forwarding, Firefox absence, and both bundle targets. The unit tests use the released CDB broker/publisher/client and mock only native Chrome I/O.

The retained native receipts in `evidence/` record Chromium **153.0.8010.12** and Firefox **156.0.1**. These are exact tested binaries, not a claim about today's stable channel. Chromium observed the title action, a real CDB `Runtime.consoleAPICalled` event and value `42`, raw native value `63` after client disposal, one attachment/detachment, two successful Runtime enable/disable pairs, zero outstanding leases, and the expected post-revocation command failure. The raw command bypasses CDB leases and is deliberately confined to the trusted host test. Firefox observed the actual missing API and unavailable contribution path. Fresh runs write complete receipts to ignored `artifacts/`.
