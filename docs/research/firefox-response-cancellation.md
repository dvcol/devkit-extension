# Native Firefox response cancellation evidence

The [production recipe](../../examples/webext/src/response-contribution.ts) remains unchanged. The maintained [cancellation pair](../../examples/webext/tests/response-cancellation.ts) uses the existing native contribution controls and an owned no-store HTTP response. Both cases consume `native:first-caf` before cancelling while the server holds the remaining split UTF-8 input open.

## Observed Firefox 157.0 behavior

| Native page operation           | Page result                                                                                      | Held input before release                                                                                          | Native filter result                                                                                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reader.cancel()`               | Cancellation and `reader.closed` fulfill; pending and subsequent reads finish with `done: true`. | Response and socket remain open during the maintained 1,000 ms observation.                                        | Existing `completed` stays zero and `errors` stays empty. After listener disposal, a fresh request is untransformed; explicitly releasing the admitted input produces native `onstop`/`close`, increments `completed`, and closes the response/socket. |
| Fetch `AbortController.abort()` | Pending read, `reader.closed`, and subsequent read reject with native `AbortError`.              | Response/socket close before any server release; `responseEnded` is false and the server records request abortion. | Native `onstop`/`close` increments `completed`; `errors` stays empty. A later transformed request succeeds, and disposal stops future admissions.                                                                                                      |

The initial temporary probe observed reader cancellation without upstream closure or filter stop/error for ten seconds. A trace-only disposable extension copy recorded actual native handler events; an unchanged copy with the same artifact hash reproduced the page, counter and socket outcomes. Fetch abort additionally emitted native `webRequest.onErrorOccurred` with `NS_BINDING_ABORTED`, while `StreamFilter.onerror` did not fire. Browser, temporary profile, copied extension and all server connections were cleaned up.

The maintained receipts expose `cancellation.reader` and `cancellation.fetch`: page outcomes, before/terminal snapshots, held response/socket observations, and later admission checks. The `completed` field counts the recipe's native `onstop`/`close` handler; it does not mean successful page consumption.

## Commands and retained results

```sh
FIREFOX_BINARY=/Applications/Firefox.app/Contents/MacOS/firefox pnpm --filter @devkit/example-webext test:firefox
FIREFOX_BINARY=/Applications/Firefox.app/Contents/MacOS/firefox pnpm --filter @devkit/example-webext test:dev:firefox
pnpm --filter @devkit/example-webext test
pnpm --filter @devkit/example-webext lint
pnpm --filter @devkit/example-webext typecheck
pnpm --filter @devkit/example-webext format:check
```

Updated results are retained in the [production receipt](../../examples/webext/evidence/response-body/firefox-production.json) and [development receipt](../../examples/webext/evidence/response-body/firefox-development.json), alongside the existing encoding and lifecycle evidence.

## Native sources and limits

[MDN `onerror`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/StreamFilter/onerror) distinguishes filter errors from network errors. [Firefox `StreamFilterParent::OnStopRequest`](https://github.com/mozilla-firefox/firefox/blob/073470574580ca3c5d05feddc3fd7b98408e80fc/toolkit/components/extensions/webrequest/StreamFilterParent.cpp#L668) forwards the native stop status; [`StreamFilterChild::RecvStopRequest`](https://github.com/mozilla-firefox/firefox/blob/073470574580ca3c5d05feddc3fd7b98408e80fc/toolkit/components/extensions/webrequest/StreamFilterChild.cpp#L432) passes stop handling to `MaybeStopRequest`, which fires the stop event after buffered data drains without treating that status as a filter error. These pinned sources explain the observed abort result; they are not a byte-for-byte claim about the installed Firefox release.

The non-event observations are bounded measurements, not lifetime guarantees. This proves the existing running-background recipe with these ordinary loopback Fetch streams. It does not prove idle wakeup, other request consumers, page destruction, or every Firefox release. No SDK cancellation controller, automatic upstream cancellation, retry, or cleanup policy follows from the result. WebDriver Classic retains its existing global page-error capture limitation.
