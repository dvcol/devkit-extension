# Prepared draft: fix(core): retain events during subscription activation

Repository: `dvcol/chrome-debugger-bridge`. Not opened; owner approval required.

## Background (Why)

An event can arrive while `subscribe()` awaits domain activation. The broker currently registers the subscription after that wait, so it discards the event. For Fetch interception, losing `Fetch.requestPaused` can leave a request paused until the domain is disabled.

## Changes (What)

Register the subscription before activation and remove it if setup fails. If it closes during activation, release the completed demand through the original executor. This also prevents a pending subscription from becoming live after its lease or target has been revoked. Public APIs and existing asynchronous teardown behavior are unchanged.

The production change is confined to the broker, with 14 added and 5 removed lines. Regression tests cover early events, setup rejection, overflow, lease release/expiry, revocation, disposal and replacement generations.

## Verification (Testing)

Seven of eight focused cases fail against the original broker; all eight and the 80 affected core tests pass with the fix. A real Chromium reproduction holds completion of an actual successful `Fetch.enable` call while a matching response pauses. The patched subscriber receives that event and the client reads and fulfills the response before cleanup. The test controls ordering, not the browser event or response.

Affected-file lint, core and test-inclusive type checks, and the core build pass. Full repository checks remain for upstream CI. In-flight body reads, child sessions and broader concurrent activation behavior are outside this change.
