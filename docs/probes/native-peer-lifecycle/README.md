# Native peer lifecycle forwarding candidates

Checked against Devframe `72d917d5` and DevTools `cc09170e` on 2026-10-04. These are prepared native patches, not published PRs or additional SDK APIs. The installed workspace backports already permit independent implementation.

The native instance shell already calls `onPeerConnect` and `onPeerDisconnect`. `initHub` and `createDevToolsHub` omit the options when composing it. A host cannot receive those native events through either factory.

```text
Host supplies its original callbacks
  → createDevToolsHub
  → initHub
  → existing createInstanceShell
      → native RPC connection opens/closes
      → host callback receives original connection/session metadata
```

The proposal adds optional fields typed from the lower native layer and forwards their references. It has no callback wrapper, registry, authentication, routing or feature-specific state. Omitted fields retain native defaults.

```ts
// Proposed native options, available with the retained candidates:
initHub({
  base: DEVFRAMES_HUB_BASE,
  onPeerConnect: registerPeer,
  onPeerDisconnect: releasePeer,
});

await createDevToolsHub({
  context,
  onPeerConnect: registerPeer,
  onPeerDisconnect: releasePeer,
});
```

| Candidate | Production change | Focused evidence |
| --- | --- | --- |
| [Devframe patch](./devframe-peer-lifecycle.patch) | 7 added lines in the hub factory | Unchanged source: callback case fails, omitted-callback control passes. Candidate: both pass against real native WebSocket connection/session/disconnect events. |
| [DevTools patch](./devtools-peer-lifecycle.patch) | 7 additions / 1 removal in the core factory | Unchanged source: forwarding case fails, omitted-callback control passes. Candidate: both pass with the same callback references. |

Fresh frozen installs pass with pnpm 12.8.1, native Vitest 5.0.3, TypeScript 6.0.3 and ESLint 10.11.0. No dependency verification policy, manifest or lockfile changed. Root lifecycle scripts were disabled to avoid full-workspace postinstall builds. The affected graphs select 4/51 Devframe projects and 8/16 DevTools projects; explicit JSON protocol composition additionally selects 5/51 Devframe projects.

Both changed source/test pairs pass native ESLint. The native hub package typecheck passes. DevTools core types pass with the callback-capable hub source supplied explicitly under the existing source aliases, without casts, copied callback types or relaxed flags. A separate actual DevTools context, native static-token authentication and WebSocket probe passes six assertions. Restoring both original production files makes that identical probe fail on its missing connect callback. Unchanged, freshly installed native UI assets satisfy startup only; no browser rendering is claimed by that Node probe.

## Dependency and publication boundary

Current released hub 1.2.0 lacks these callback fields. The DevTools candidate produces exactly five corresponding type diagnostics against that release; unchanged DevTools source and existing tests pass with the same graph. A callback-capable hub release, or an explicit interim native source/patch graph, is required. Do not guess a release version or copy callback types to conceal the prerequisite.

The smallest publication sequence is the hub draft first, then the DevTools draft against the released hub correction. Opening both drafts immediately is possible if DevTools is explicitly marked dependent; it would not have passing dependency checks until that prerequisite is supplied. The API and downstream backports are the same either way.

The [validation receipt](./validation.json) records exact current revisions, native versions, scoped installation/check results and limits. Full upstream gates remain for CI. The [Devframe contribution guide](https://github.com/devframes/devframe/blob/72d917d5a57837b748bc9c950a0216049d13363e/CONTRIBUTING.md) links [antfu's guide](https://github.com/antfu/contribute#-using-ai), which asks the human contributor to understand the change and write publication text in their own words. These sketches are review material; final upstream wording belongs to the owner.

Suggested factual description to reword for the hub: “Expose the existing peer lifecycle callbacks through `initHub`, preserving the native callback types and arguments. This lets embedding hosts observe connection setup and cleanup without reaching into the instance shell.” For DevTools: “Forward the hub's optional peer lifecycle callbacks through `createDevToolsHub`. This requires the hub API added by the companion change.”
