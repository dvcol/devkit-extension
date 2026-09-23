# Core declaration specification

`core.d.ts` specifies the accepted core API. It contains ambient declarations only. This archived fixture remains declaration-only; the maintained implementation and equivalent type fixtures now live in [packages/core](../../packages/core/README.md), with [adapter runtime internals](../../packages/runtime/README.md) progressing separately. Complete host adapters are still outstanding. The generic registration bases erase callback argument types only when collecting heterogeneous definitions; the factories retain exact capability, action and dependency types.

`core.type-test.ts` checks positive factory inference and expected compiler errors. `tsconfig.json` enables strict checking with declaration checking retained. Zod appears only as a test validator; the declaration contract depends on Standard Schema types alone. View, script and transform entries retain common metadata here; their complete kind-specific contracts belong to their domain tickets.

Validated on 2026-09-23 with TypeScript 7.0.2, Standard Schema 1.1.0, Zod 4.6.5 and Oxlint 1.85.0. Both the full declaration/fixture type check and Oxlint correctness, suspicious and pedantic rules pass without skipped declaration checks or lint suppressions. Each `@ts-expect-error` must correspond to a compiler error; unused directives fail the check.

Reproduce independently of the old application scaffold from the repository root:

```sh
contract_probe=$(mktemp -d)
cp docs/contracts/core.d.ts docs/contracts/core.type-test.ts docs/contracts/tsconfig.json "$contract_probe/"
printf '{"private":true,"type":"module"}\n' > "$contract_probe/package.json"
pnpm --dir "$contract_probe" add --save-dev --save-exact --ignore-scripts --registry=https://registry.npmjs.org typescript@7.0.2 @standard-schema/spec@1.1.0 zod@4.6.5 oxlint@1.85.0
pnpm --dir "$contract_probe" exec tsc --project tsconfig.json
pnpm --dir "$contract_probe" exec oxlint -D correctness -D suspicious -D pedantic --deny-warnings core.d.ts core.type-test.ts
```

The [proof matrix](./CORE-API-MATRIX.md) defines the runtime obligations still to implement. Passing this check proves declaration inference and rejection behavior, not execution, cleanup, wire validation or browser compatibility.
