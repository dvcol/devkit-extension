# Prepared draft: fix: skip replies after RPC closure

Repository: `antfu-collective/birpc`. Not opened; owner approval required. Candidate base: `e62dda59`.

## Background (Why)

An incoming handler can finish after `$close()` removes its listener and marks the RPC closed. The response path still serializes and posts its result. A transport that rejects writes after disconnection therefore receives a late write; a disconnected Chrome runtime Port exposes this as an unhandled error.

## Changes (What)

Check the existing closed flag immediately before replying. Admitted handlers still finish, and `onFunctionError` still reports their failures. The production change is one guard in `src/main.ts`; success and failure regressions extend the existing close test file. There is no public API or transport change.

## Verification (Testing)

The regression uses two native `createBirpc` peers with a deferred handler:

1. Start a call and wait until its handler begins.
2. Close both peers; the caller rejects with the existing closed error.
3. Release the handler, once with a result and once with an error.
4. Await native message handling and inspect response serialization and posting. Unchanged source performs one late post in both cases; the correction performs neither. The failing handler still reaches `onFunctionError`.

Against the unchanged `e62dda59` source, the two new cases fail and eight existing close/error/resolver controls pass. With the guard, all ten pass using the frozen native dependency graph: pnpm 11.21.0, Node 26.9.0 and Vitest 4.1.10. Run:

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run test/close.test.ts test/error.test.ts test/resolver.test.ts
```

Changed-file native ESLint, package TypeScript and package build pass. Full repository testing remains for CI. This guard covers closure during an awaited resolver or handler; it does not cover every race during an asynchronous transport post or cancel admitted work.
