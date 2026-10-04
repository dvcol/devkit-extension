# fix(extension): make detached-child demand disposal idempotent

After `Target.detachedFromTarget`, the publisher has already removed the child session and its subscription demands. Disposing a subscription then rejects because `setSubscriptionDemand` validates the missing session before noticing the demand is already inactive.

Move the existing demand/no-op check before child-session lookup. Method validation stays first, new activation on the missing child still rejects, and live-child disable behavior is unchanged. The production diff adds and removes two lines.

## Reproduction

1. Publish a root target and attach a native child session.
2. Activate `Runtime.consoleAPICalled` or the `Runtime.` prefix for that child.
3. Deliver the actual `Target.detachedFromTarget` event.
4. Deactivate the child's existing demand during subscription disposal. Original source rejects with `The requested session is not available.` The candidate returns without issuing a Chrome command.
5. Attempt new activation on the old child. Both versions correctly reject it.

Four native regressions cover exact and prefix demands, one live-child disable, invalid methods and native disable errors. Two fail and two controls pass on original upstream `4053273d`; all four pass with the change. Existing actual Chromium child-removal acceptance passes through both native backends with the byte-equivalent installed backport.

## Validation

The frozen native graph, changed-file lint, cold source types, focused regression types and extension build pass. The affected extension package passes all 106 tests with this fix and the independent worker-restoration candidate applied. No public API or SDK logic changes. Full upstream checks remain for CI; already-running child-command settlement is outside this correction.
