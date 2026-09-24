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
      target: 'required',
    }),
  },
});
```

| Shared contract                                    | Implementation                                                   | Plugin property |
| -------------------------------------------------- | ---------------------------------------------------------------- | --------------- |
| `defineCapability({ id, version, operations })`    | `defineService({ capability, id, execution, requires?, setup })` | `services`      |
| `defineActionContract({ id, version, operation })` | `defineAction({ contract, id, execution, requires?, handler })`  | `actions`       |
| `defineContributionKind({ id, schema })`           | `defineExtension({ descriptor, id, execution, payload })`        | `extensions`    |

Each helper takes one object. Contracts preserve inference for handler input, result, target and named dependencies. `defineAction` now defines the handler; the former contract helper is named `defineActionContract`.

Factories reject invalid identifiers, non-positive or unsafe contract versions, unknown core declaration fields, wrong contribution kinds, malformed Standard Schema protocols and invalid execution/requirement descriptors. They snapshot and freeze declaration records, nested contract and operation envelopes, execution identities, requirements and plugin lists. Mutating a structural input afterward cannot change an admitted definition's identity or dependencies. Imported schemas, payload values and handlers keep their identity and ownership; factories never freeze caller-owned objects.

Definition creation does not run setup, handlers or schema validators. The provider validates custom payloads during admission and operation values during invocation, including asynchronous schemas. Both input and result types use Standard Schema `InferInput`; validation must not substitute transformed schema output.

Views, transforms and scripts currently have only their agreed common declaration envelope. Their domain adapters own exact fields, validation and activation. `definePlugin` checks their common ID, kind and execution while preserving those domain fields. Duplicate admission, service lifecycle, routing and schema execution belong to runtime/adapters, not this package.

Provider descriptors carry a stable configured `id` and a mandatory opaque `incarnation` issued once by the adapter for each backend lifetime. Client reconnects and updates within that lifetime keep the same incarnation. A newly created backend receives a fresh one.

Run package checks from the workspace root:

```sh
pnpm --filter @devkit/core typecheck
pnpm --filter @devkit/core lint
pnpm --filter @devkit/core format:check
pnpm --filter @devkit/core test
pnpm --filter @devkit/core build
```

`tests/core.type-test.ts` compiles against the implementation and preserves the 28 negative declaration fixtures. `tests/requests.type-test.ts` adds 12 negative request fixtures, including dynamic operation/input correlation and rejection of the removed positional calls. Runtime tests exercise inertness, shape validation, collection ownership and portable errors. These package checks do not establish provider or browser conformance.

## Invocation requests

Core declares the client interfaces; provider adapters implement execution. Capability and action clients accept a single scoped request:

```ts
const value = await capabilities.invoke({
  capability: title,
  operation: 'read',
  input: { prefix: 'Current: ' },
  target,
  signal,
});
const selected = await capabilities.resolve({ capability: title, target });
const result = await actions.invoke({ action: readTitle, input: { prefix: '' }, target });
```

`CapabilityInvocationRequest`, `ActionInvocationRequest`, `OperationRequest` and `CapabilityResolutionRequest` expose these types to adapters and callers. Operation names and descriptors determine payload, result and required-target types; input cannot widen the imported contract. When an operation name is a union, callers must preserve its corresponding payload and target as a union of complete requests.

Local provider handles accept `resolve({ capability })` and `invoke({ action, input, target?, signal? })`. They are already owned by one provider and accept no routing options. A resolved capability still uses `binding.api.read(input, { target, signal })`. Business input remains nested under `input`, so payload fields named `target` or `signal` cannot alter execution metadata.
