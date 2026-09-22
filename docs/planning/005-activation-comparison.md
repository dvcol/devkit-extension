# Contribution activation: two authoring styles

Part of [Contribution and realm contract](https://github.com/dvcol/devkit-extension/issues/5). The owner selected explicit capability and realm descriptors. Activation style remains open. All API names below are illustrative, not implemented exports.

Compare the same inspector: it publishes a JSON view and adds debugger actions when a debugger provider is available. Both snippets run in a provider entry. The renderer mounts the published JSON in its own UI entry. Content, page and native implementation entries remain separately packaged in either design.

## Shared code in both versions

`jsonViews`, `actionRegistry` and `debuggerCommands` are imported explicit descriptors. Both versions use exactly the same `installInspector` and `installDebuggerTools` functions.

```ts
function installDebuggerTools({ actions, debuggerApi }, scope) {
  scope.use(actions.register(captureSnapshot, async (input) => {
    return debuggerApi.captureSnapshot({
      target: input.target,
      signal: scope.signal,
    });
  }));
}
```

`captureSnapshot` is the example's imported action descriptor. The action registry returns a disposable registration, adopted by `scope.use`. The scope's cancellation signal covers that activation's calls. `captureSnapshot` on the debugger API is an illustrative operation to make the example concrete; this does not settle the debugger contract's command model. `installInspector` similarly publishes the common JSON view and adopts its registrations into its supplied scope.

Both versions use these same proposed runtime guarantees:

- A scope owns registrations and child activations, cancels its signal and disposes resources idempotently.
- Starting a child activation handles setup failure by unwinding its resources and returning a failed activation outcome for reporting. It does not silently terminate unrelated children.
- Capability observation supplies an initial snapshot without a subscribe/read gap, then serialized changes including binding replacement. It is scoped to the current provider and target generation.
- A live binding represents an eligible implementation, not an automatically attached debugger session. User-triggered privileged work still occurs through actions and the permission/ownership rules.

These are comparison assumptions for both designs. Async disposal ordering, retry policy and permission behavior still require contract decisions. Abrupt worker termination cannot guarantee JavaScript cleanup.

## A. Host-managed features

The author declares each feature's requirements. The host connects availability to activation and disposal.

```ts
export default defineProviderEntry({
  features: {
    inspector: {
      requires: { views: jsonViews, actions: actionRegistry },
      activate({ capabilities, scope }) {
        installInspector(capabilities, scope);
      },
    },

    debuggerTools: {
      requires: {
        debuggerApi: debuggerCommands,
        actions: actionRegistry,
      },
      whenAvailableAgain: 'reactivate',
      activate({ capabilities, scope }) {
        installDebuggerTools(capabilities, scope);
      },
    },
  },
});
```

The host resolves every required descriptor before calling `activate`, supplies typed capability bindings, and creates the feature's scope. `whenAvailableAgain` makes this example's chosen behavior explicit; the API name and default remain open.

If debugger availability disappears, the host disposes only `debuggerTools`. Its actions are unregistered and its operation signals are cancelled. The inspector stays active. When a valid binding returns, the host starts a fresh debugger-tools scope under the explicit reactivation policy. Re-registering an action does not invoke it or request permission.

Feature requirements and activation outcomes are inspectable by the host. `activate` is still ordinary code: authors can branch, register native listeners and manage resources inside their feature scope.

## B. One setup function per provider execution

The contribution owns the availability-to-lifetime connection. It still receives the same typed descriptors and scope helpers; it does not need to reinvent resource disposal.

```ts
export default defineProviderEntry({
  requires: { views: jsonViews, actions: actionRegistry },

  activate(context) {
    installInspector(context.capabilities, context.scope);

    let debuggerActivation;

    context.scope.use(
      context.observeCapability(debuggerCommands, (binding) => {
        debuggerActivation?.dispose();
        debuggerActivation = undefined;

        if (binding.status !== 'available') return;

        debuggerActivation = context.scope.startChild((scope) => {
          installDebuggerTools({
            actions: context.capabilities.actions,
            debuggerApi: binding.api,
          }, scope);
        });

        reportActivationOutcome('debuggerTools', debuggerActivation);
      }),
    );
  },
});
```

`reportActivationOutcome` is the example's reporting helper, not an implicit SDK feature registry. `startChild` parents the child activation to the entry scope, so closing the entry disposes both its observer and any active child. The observer's sequence implements the same reactivation behavior as A. Production types would name the activation handle; the sketch omits type boilerplate to focus on ownership.

If debugger availability disappears, the author's callback disposes the debugger child while leaving the inspector active. If availability returns, the callback creates a fresh child. The host knows the child resources, but the semantic label, requirements and relationship to debugger availability live in the author's code unless separately declared.

As optional capabilities grow, the author adds observers and combines their readiness. Grouping them into one activation and propagating dependent failures also belongs to this setup code. The host still enforces authorization and stale-target rejection at invocation time in either design.

## Behavior and tradeoffs

| Situation | A: host-managed features | B: one setup function |
| --- | --- | --- |
| Firefox has no applicable debugger provider | Host leaves debugger feature unavailable | Observer receives unavailable; callback returns |
| Debugger binding disappears | Host disposes the affected feature | Author callback disposes the child |
| A compatible binding returns | Declared policy starts a new feature scope | Author callback starts a new child |
| Several capabilities are required together | Host resolves the declared requirement group | Author combines observations and readiness |
| Show why functionality is inactive | Host can expose declared requirements and outcomes | Contribution supplies semantic status/reporting |
| Custom lifecycle conditions | Put imperative logic inside a feature | Express conditions directly in setup |
| Small contribution without optional behavior | One feature with one activation | One setup function |

I recommend A as the normal authoring model, while retaining scopes and imperative APIs inside `activate`. The host owns repetitive availability/lifecycle wiring and diagnostics; contributions keep control of their behavior. B is reasonable if minimizing declarative concepts matters more than uniform lifecycle behavior across third-party contributions.

Open choice: A or B as the primary authoring model. Selecting A does not yet choose automatic reactivation as the default; both sketches explicitly demonstrate reactivation only to make their behavior comparable.
