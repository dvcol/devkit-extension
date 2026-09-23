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

Factories reject invalid identifiers, non-positive or unsafe contract versions, unknown core declaration fields, wrong contribution kinds, malformed Standard Schema protocols and invalid execution/requirement descriptors. They snapshot and freeze declaration records, nested contract and operation envelopes, execution identities, requirements and plugin lists. Mutating a structural input afterward cannot change an admitted definition's identity or dependencies. Imported schemas, payload values and handlers keep their identity and ownership; factories never freeze caller-owned objects.

Definition creation does not run setup, handlers or schema validators. The provider validates custom payloads during admission and operation values during invocation, including asynchronous schemas. Both input and result types use Standard Schema `InferInput`; validation must not substitute transformed schema output.

Views, transforms and scripts currently have only their agreed common declaration envelope. Their domain adapters own exact fields, validation and activation. `definePlugin` checks their common ID, kind and execution while preserving those domain fields. Duplicate admission, service lifecycle, routing and schema execution belong to runtime/adapters, not this package.

Run package checks from the workspace root:

```sh
pnpm --filter @devkit/core typecheck
pnpm --filter @devkit/core lint
pnpm --filter @devkit/core format:check
pnpm --filter @devkit/core test
pnpm --filter @devkit/core build
```

`tests/core.type-test.ts` compiles against the implementation and preserves the 25 accepted negative declaration fixtures. Runtime tests exercise inertness, shape validation, collection ownership and portable errors. These package checks do not establish provider or browser conformance.
