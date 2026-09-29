# Who configures intercepted traffic

Status: owner decision required. The examples below are proposals, not maintained SDK APIs. This is the next contract decision for [Injection and transform contract](https://github.com/dvcol/devkit-extension/issues/11). It is separate from the pending JSON renderer routing choice and approval for the CDB subscription-fix draft.

## Implemented behavior

The maintained [fixed-response example](../../examples/debugger/README.md#fixed-response-interception) configures a native `ChromeDebuggerPort` before creating its host:

```ts
const host = createDebuggerHost(
  'chromium',
  console.error,
  responseDebugger('https://example.test/api/*'),
);
```

CDB owns the debugger attachment, the lease and the first/last demand for Fetch. The port supplies the fixed native pattern when CDB calls `Fetch.enable`. One native subscription reads a matching response and the example fulfills it. This works now and has real-browser evidence. It does not implement multiple transform contributions.

```mermaid
flowchart LR
  Policy[Host's fixed native pattern] --> Port[ChromeDebuggerPort]
  CDB[CDB domain-demand owner] -->|Fetch.enable| Port
  Port --> Chrome[Chrome pauses matching responses]
  Chrome --> Subscription[One CDB subscription]
  Subscription --> Example[One local response handler]
  Example -->|fulfillRequest through its lease| Chrome
```

Changing the port's stored parameters alone cannot update active interception. CDB's current public demand method accepts `methodPrefix`, `active` and optional `sessionId`. Another subscriber adds demand but does not cause another configured `Fetch.enable`. Sending an independent raw enable would introduce a competing owner. These facts are documented in the [native response investigation](../research/cdb-response-transform.md#ownership-and-limits).

The decision is about who can change **which traffic Chrome pauses**, not how clients choose a realm/provider. Domain and URL matching remain provider/capability concerns. RPC continues to carry validated inputs and results, never executable callbacks.

## A: the host fixes interception coverage

The host configures the intercepted traffic before starting its backend. Contributions filter and transform only responses inside that set. Installing a plugin cannot expand it. Hosts can choose a broad pattern when that is appropriate for their application.

```ts
// Proposed authoring shape only; defineResponseTransform is not implemented.
const hostPolicy = {
  patterns: [{ urlPattern: 'https://example.test/api/*', requestStage: 'Response' }],
};

const plugin = definePlugin({
  id: 'example.feature-overrides',
  transforms: [
    defineResponseTransform({
      id: 'example.flags',
      matches: ({ url }) => new URL(url).pathname === '/api/flags',
      transform: ({ body }) => overrideFlags(body),
    }),
  ],
});
```

```mermaid
flowchart LR
  Host[Host policy] --> Native[CDB's native interception configuration]
  Native --> Owner[Provider-local response owner]
  Plugin[Contribution installs or disables] -->|local handler registration only| Owner
  Owner -->|one final response| Browser[Browser]
```

This avoids dynamic native pattern reconciliation. A plugin that needs traffic outside the host's coverage cannot work until the host configuration changes. A broad filter pauses unrelated traffic too, so the response owner must still continue responses with no matching handler. Host policy does not eliminate the need for one owner of a paused request or for overlap/failure rules.

The exact unsupported outcome would be explicit where coverage can be established. Arbitrary callback predicates cannot be compared with native URL patterns automatically; we should not add a predicate-analysis utility or imply that configuration proves coverage.

## B: contributions request interception coverage

Each contribution declares native interception patterns alongside its local handler. Installing or disabling a contribution changes active demand. The native CDB domain owner reconciles pattern demand. Provider-local code owns the response handlers. CDB does not import SDK contribution types or application transforms; the generic SDK does not send competing enable/disable commands or maintain a second debugger broker.

```ts
// Proposed authoring shape only; names and remaining fields are not settled.
const plugin = definePlugin({
  id: 'example.feature-overrides',
  transforms: [
    defineResponseTransform({
      id: 'example.flags',
      patterns: [
        { urlPattern: 'https://example.test/api/flags*', requestStage: 'Response' },
      ],
      transform: ({ body }) => overrideFlags(body),
    }),
  ],
});

// Existing plugin lifecycle; the proposed native integration follows its lifetime.
const handle = await provider.plugins.install(plugin);
await handle.disable();
```

```mermaid
flowchart LR
  One[Contribution A] -->|pattern demand| CDB[Native CDB domain owner]
  Two[Contribution B] -->|pattern demand| CDB
  One -->|local handler| Responses[Provider-local response owner]
  Two -->|local handler| Responses
  CDB -->|native configuration| Chrome[Chrome]
  Chrome -->|native event subscription| Responses
  Responses -->|one final response through CDB lease| Chrome
  Portable[Generic contribution lifecycle] -->|activate or dispose| One
  Portable -->|activate or dispose| Two
```

This better supports independently installed plugins. The current CDB demand API cannot express the configuration update, so it needs a narrow native design and proof before a local patch. That native work would handle domain configuration only; application transformation logic stays downstream. An upstream draft would still require explicit approval after a concrete diff and tests are prepared.

Native reconciliation must preserve existing handlers and already paused requests while demand changes. A failed update must reject the new registration or report its failure, rather than claim that Chrome uses a configuration it never accepted. Disabling one contribution must preserve another's coverage. Updating configuration cannot replay an action or silently move an already dispatched operation to another provider.

## Comparison and recommendation

| Concern | A: host coverage | B: contribution coverage |
| --- | --- | --- |
| Plugin changes intercepted URLs | Requires host configuration change | Part of native registration lifetime |
| Current native API fit | Fixed-pattern mechanism is proved | Dynamic configuration needs native work |
| Generic SDK responsibility | Existing contribution lifecycle and explicit availability | Same; native CDB still owns interception |
| Broad interception cost | Host may choose a superset | Active contributions can request narrower traffic |
| Overlap and response ownership | Still needs one response owner | Still needs one response owner |
| Runtime configuration failure | Mostly host startup/reconfiguration | Also plugin installation and disable |
| Maintenance cost | Smaller adapter; more host configuration | Additional native contract and compatibility tests |

For the stated goal of independently extensible plugins, I recommend **B**, with the configuration mechanism owned by CDB and a minimal portability adapter. A is simpler if fixed host coverage is an acceptable product constraint. The maintained fixed example remains useful evidence for either choice; it does not silently choose A as the final API.

Transform ordering, unmatched-response handling and failure policy follow this decision. Those options will need their own concrete native evidence and sketches. No general callback pipeline, retry controller, dynamic patch or new upstream PR is implemented by this note.
