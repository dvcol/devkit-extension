# @devkit/core

The portable declaration package implements the settled contract from issue 5. It exports the agreed shared types, inert definition factories and `isOperationError`. It has no Node, renderer, browser-extension or provider-runtime dependencies.

```ts
import { defineCapability, defineOperation } from '@devkit/core';
import { z } from 'zod';

export const title = defineCapability({
  id: 'example.title',
  version: 1,
  operations: {
    read: defineOperation({
      input: z.object({ prefix: z.string() }),
      output: z.string(),
    }),
  },
});
```

| Shared contract                                              | Implementation                                                   | Plugin property |
| ------------------------------------------------------------ | ---------------------------------------------------------------- | --------------- |
| `defineCapability({ id, version, operations })`              | `defineService({ capability, id, execution, requires?, setup })` | `services`      |
| `defineActionContract({ id, version, operation, routing? })` | `defineAction({ contract, id, execution, requires?, handler })`  | `actions`       |
| `defineContributionKind({ id, schema })`                     | `defineExtension({ descriptor, id, execution, payload })`        | `extensions`    |

Each helper takes one object. Contracts preserve inference for handler input, result and named dependencies. `defineAction` now defines the handler; the former contract helper is named `defineActionContract`.

Factories reject invalid identifiers, non-positive or unsafe contract versions, unknown core declaration fields, wrong contribution kinds, malformed Standard Schema protocols and invalid execution/requirement descriptors. They snapshot and freeze declaration records, nested contract and operation envelopes, execution identities, requirements and plugin lists. Mutating a structural input afterward cannot change an admitted definition's identity or dependencies. Imported schemas, payload values and handlers keep their identity and ownership; factories never freeze caller-owned objects.

Definition creation does not run setup, handlers or schema validators. The provider validates custom payloads during admission and operation values during invocation, including asynchronous schemas. Both input and result types use Standard Schema `InferInput`; validation must not substitute transformed schema output.

Views, transforms and scripts currently have only their agreed common declaration envelope. Their domain adapters own exact fields, validation and activation. `definePlugin` checks their common ID, kind and execution while preserving those domain fields. Duplicate admission, service lifecycle, routing and schema execution belong to runtime/adapters, not this package.

Provider descriptors carry a stable configured `id` and a mandatory opaque `incarnation` issued once by the adapter for each backend lifetime. Client reconnects and updates within that lifetime keep the same incarnation. A newly created backend receives a fresh one.

Run package checks from the workspace root:

```sh
pnpm --filter @devkit/core build
pnpm --filter @devkit/core typecheck
pnpm --filter @devkit/core lint
pnpm --filter @devkit/core format:check
pnpm --filter @devkit/core test
```

`tests/core.type-test.ts` compiles against the implementation and checks negative declaration fixtures. `tests/requests.type-test.ts` adds 12 negative request fixtures, including dynamic operation/input correlation and rejection of the removed positional calls. `tests/routing.type-test.ts` adds seven negative selector/default fixtures. Runtime tests exercise inertness, shape validation, collection ownership and portable errors. These package checks do not establish provider or browser conformance.

`tests/declarations.test.ts` additionally compiles five accepted consumers and 19 isolated rejected consumers through the built `@devkit/core` package export. Run the build first. Strict TypeScript 7 checks operation/payload/result correlation, broadcast selection and outcomes, guard-only schema transforms, named requirements and local/remote native context access. Each rejected consumer must produce its expected single diagnostic, without `@ts-expect-error` or source aliases. This complements the existing packed-package checks; it does not claim every exported type member is covered.

## Invocation requests

Core declares the client interfaces; provider adapters implement execution. Capability and action clients accept a single scoped request:

```ts
const value = await capabilities.invoke({
  capability: title,
  operation: 'read',
  input: { prefix: 'Current: ' },
  signal,
});
const selected = await capabilities.resolve({ capability: title });
const result = await actions.invoke({ action: readTitle, input: { prefix: '' } });
```

`CapabilityInvocationRequest`, `ActionInvocationRequest`, `OperationRequest` and `CapabilityResolutionRequest` expose these types to adapters and callers. Operation names and descriptors determine payload and result types; input cannot widen the imported contract. When an operation name is a union, callers must preserve its corresponding payload as a union of complete requests.

Local provider handles accept `resolve({ capability })` and `invoke({ action, input, signal? })`. They are already owned by one provider and accept no routing options. A resolved capability still uses `binding.api.read(input, { signal })`. Business input remains nested under `input`, so payload fields named `target` or `signal` cannot alter execution metadata.

Resource identifiers and domain filters belong to each operation’s input schema. There is no common `TargetReference`, target declaration mode or top-level target option. An implementation may return its own schema-defined `not-applicable` result. Provider incarnation and activation ownership remain SDK concerns.

## Declarative routing

`RouteSelector` requires a string `realm` and accepts an optional string `provider` scoped to that realm. `RoutingDirective` is one selector or a non-empty, ordered fallback list. Identifiers must contain a non-whitespace character; their spelling is preserved without normalization. Provider-only selectors, empty lists, unknown fields and non-string identifiers are rejected during action declaration validation.

```ts
const readTitle = defineActionContract({
  id: 'example.read-title',
  version: 1,
  operation,
  routing: [{ realm: 'devserver', provider: 'frontend' }, { realm: 'webext' }],
});
```

The factory snapshots and freezes the selectors and list. The default belongs to the public action contract so clients can inspect it before choosing a backend. A routed request's explicit `routing` replaces the whole default. An ordered list describes fallback before dispatch to one provider; it never requests broadcast or permits replay after dispatch.

This package implements declaration validation, immutable metadata and request types. It does not execute selection. Local provider handles continue to use their fixed provider. `@devkit/client` implements local multi-provider selection, callbacks and broadcast; authenticated remote discovery remains issue 7 work.

`RoutingPolicy` also accepts a local `RoutingCallback` receiving immutable candidate identities/availability, ordinary input and cancellation. Factories preserve callback identity without executing or freezing caller code. Callbacks are not portable catalog metadata.

`CapabilityClient.broadcast` and `ActionClient.broadcast` preserve request input/output inference and return typed `BroadcastOutcome<Value>[]`. They require a non-empty `selection` list and reject ordinary `routing` options. `tests/broadcast.type-test.ts` verifies these constraints. See the [client contract](../client/README.md) for preflight errors, dispatch behavior and ownership.
