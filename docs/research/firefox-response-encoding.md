# Native Firefox response encoding evidence

The [production recipe](../../examples/webext/src/response-contribution.ts) is unchanged. It writes `native:` in native `onstart`, then forwards each `ondata.data` directly and closes in `onstop`. There is no extension decompressor, buffer, header mutation or cancellation registry.

## Native source, inspected 2026-10-02

- [Firefox source StreamFilterParent::Init](https://github.com/mozilla-firefox/firefox/blob/073470574580ca3c5d05feddc3fd7b98408e80fc/toolkit/components/extensions/webrequest/StreamFilterParent.cpp) installs the filter listener with `aMustApplyContentConversion=true`.
- [Firefox source nsHttpChannel](https://github.com/mozilla-firefox/firefox/blob/073470574580ca3c5d05feddc3fd7b98408e80fc/netwerk/protocol/http/nsHttpChannel.cpp) applies native content conversion before delivering data to listeners when `LoadListenerRequiresContentConversion()` is true. The resulting converter is installed as the listener.
- [Firefox source HttpBaseChannel](https://github.com/mozilla-firefox/firefox/blob/073470574580ca3c5d05feddc3fd7b98408e80fc/netwerk/protocol/http/HttpBaseChannel.cpp) calls `DoApplyContentConversionsInternal` with `aRemoveEncodings=false` in the ordinary conversion path. Header removal is a distinct path. This supports the inference that ordinary gzip/deflate conversion supplies decoded filter bytes while retaining encoded response header metadata.
- [Native gzip regression](https://github.com/mozilla-firefox/firefox/blob/073470574580ca3c5d05feddc3fd7b98408e80fc/toolkit/components/extensions/test/xpcshell/test_ext_webRequest_filterResponseData.js#L76) decodes a gzip filter's event data as UTF-8, writes encoded UTF-8 back, and verifies readable HTML content. Native conversion supplies the decoded filter bytes.
- [MDN native API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/filterResponseData) retains responsibility for writing and closing/disconnecting the native stream. It does not promise that a body transformation rewrites headers.

All source links are pinned to `073470574580ca3c5d05feddc3fd7b98408e80fc`. The two networking files match the inspected copies byte-for-byte. This current source explains the observed native behavior; it is not a claim that every source file equals the installed Firefox 157 release.

## Actual unchanged recipe, Firefox 157.0

Both maintained commands passed on Firefox 157.0:

```sh
pnpm --filter @devkit/example-webext test:firefox
pnpm --filter @devkit/example-webext test:dev:firefox
```

The unchanged production recipe prefixes decoded native data and forwards each incoming chunk. All five cases below match in the [production receipt](../../examples/webext/evidence/response-body/firefox-production.json) and [development receipt](../../examples/webext/evidence/response-body/firefox-development.json). The production driver quit successfully, and the development receipt confirms native stop closed its browser. Existing redirect, split UTF-8 streaming and disposal assertions also pass.

| Native case            | Original wire bytes | Unmatched delivered bytes | Matched delivered bytes | Exposed encoding | Exposed content length | Exposed transfer encoding |
| ---------------------- | ------------------: | ------------------------: | ----------------------: | ---------------- | ---------------------- | ------------------------- |
| identity, fixed length |                  15 |                        15 |                      22 | absent           | 15                     | absent                    |
| gzip, fixed length     |                  35 |                        15 |                      22 | gzip             | 35                     | absent                    |
| gzip, chunked          |                  35 |                        15 |                      22 | gzip             | absent                 | chunked                   |
| deflate, fixed length  |                  23 |                        15 |                      22 | deflate          | 23                     | absent                    |
| deflate, chunked       |                  23 |                        15 |                      22 | deflate          | absent                 | chunked                   |

All unmatched results equal the exact UTF-8 bytes of `original-世界`. All matched results equal the exact UTF-8 bytes of `native:original-世界`. Each original fixed header remains visible even though the transformed body length differs. All five admitted filters completed; native errors stayed empty. There were no failed Fetch/body-read operations.

## Maintained proof and limits

[`response-encoding.ts`](../../examples/webext/tests/response-encoding.ts) adds only these five fixed Node HTTP fixtures plus browser byte/header observation and assertions. [`response-body.ts`](../../examples/webext/tests/response-body.ts) invokes the encoding proof in the existing active native recipe and retains the existing redirect error, later-request recovery, held split-UTF-8 stream, disposal and fresh-request lifecycle checks. [`firefox-response-body.ts`](../../examples/webext/tests/firefox-response-body.ts) supplies the existing real WebDriver composition.

This proves ordinary no-store HTTP loopback Fetch responses with valid gzip and zlib-wrapped deflate, fixed lengths and chunked framing, through the existing running Firefox background. It does not prove brotli/zstd, malformed or truncated encodings, range responses, service-worker/script caching, HTTP/2 or HTTP/3, or external re-encoding/forwarding. The exposed original `Content-Length` must not be interpreted as the transformed body size. No automatic header-normalization guarantee or new SDK policy follows from this test. Native event-page wakeup remains separately unproved.

Consumers that forward transformed data over another HTTP connection own its headers and encoding. The observed Fetch composition leaves the original response headers visible and adds no SDK header-normalization contract.
