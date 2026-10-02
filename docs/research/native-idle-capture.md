# Native Chromium idle screenshot investigation

The first attempt of [CI at `bc5baa5`](https://github.com/dvcol/devkit-extension/actions/runs/36990067465) and the second attempt of [CI at `01aa441`](https://github.com/dvcol/devkit-extension/actions/runs/36994787446) timed out at the final `Page.captureScreenshot` command. Their idle/recovery assertions had already completed. Intervening full CI runs passed the unchanged fixture. The Linux timeout is not reproduced locally; no Chromium root cause or upstream fix is established.

## Observed capture state

The fixture restores two extension panel tabs and captures the first after opening the second. A copied, otherwise unchanged native test records the first tab as loaded and connected, with a 756 × 413 viewport, but hidden and unfocused. A comparison run changes only the capture boundary by calling native `Page.bringToFront` first.

| Observation                                     | Original capture                       | Foreground capture                    |
| ----------------------------------------------- | -------------------------------------- | ------------------------------------- |
| Target document before capture                  | Complete, connected, hidden, unfocused | Complete, connected, visible, focused |
| Document, target and session through activation | Unchanged                              | Unchanged                             |
| Natural worker idle                             | 30,002 ms                              | 30,003 ms                             |
| Restored counter / subsequent confirmed value   | 10 / 11                                | 10 / 11                               |
| Worker DevTools attachments / page errors       | None / none                            | None / none                           |
| Local screenshot                                | Passed                                 | Passed                                |

Both runs use Chrome `153.0.8010.12`, Node `24.20.0`, macOS and the same existing persistent extension artifact, SHA-256 `7b22280f81d8fb3cf2ab1eb36f87f14a3ed39780e9cf65638955f1858878c500`. The capture probe establishes the visibility difference, not a Linux failure reproduction. Its raw counter text contains renderer CSS and is not used as value evidence; the native test's assertions and screenshot establish counter 11.

## Native behavior and minimal change

In the [tested Chromium revision's capture implementation](https://chromium.googlesource.com/chromium/src/+/971a7443b0c9b0a9b2860529b33331b76077ec62/content/browser/devtools/protocol/page_handler.cc#1430), screenshot capture increments a capturer count with `stay_hidden: true` and obtains a rendered surface. This supports hidden capture, but still depends on its native painting/surface path. [Native `BringToFront`](https://chromium.googlesource.com/chromium/src/+/971a7443b0c9b0a9b2860529b33331b76077ec62/content/browser/devtools/protocol/page_handler.cc#1744) activates the owning WebContents.

The maintained fixture now makes the panel visible immediately before its final screenshot:

```ts
await connection.command('Page.bringToFront', {}, panel.sessionId);
await connection.command('Page.captureScreenshot', {}, panel.sessionId);
```

This removes the unnecessary hidden-capture dependency. It adds no SDK behavior, timeout extension, retry or recovery mechanism. Activation happens after the idle/recovery assertions; worker observation and every feature assertion remain unchanged. A passing CI rerun can establish acceptance of this fixture change, but cannot identify the earlier timeout's cause.

## Maintained confirmation

```sh
VITE_COUNTER_STORAGE_KEY=example.persisted-counter pnpm --filter @devkit/example-webext test:persistence:chromium:idle
pnpm --filter @devkit/example-webext lint
pnpm --filter @devkit/example-webext typecheck
```

The maintained foreground version passes on the same browser and artifact: natural idle 30,010 ms, a fresh worker/provider, restored counter 10, one rendered action saved as 11, independent key 44, no worker attachment and no page errors. The screenshot visibly shows the connected panel and counter 11. Its owned browser and profile are closed and removed. The generated receipt remains `examples/webext/artifacts/persistence/chromium-idle.json`; CI retains it and the screenshot.

The separate Firefox development navigation timeout in the first `01aa441` attempt remains unexplained. Both base and current Firefox development runs pass locally, including identically instrumented runs. Cancellation completed before that failing navigation. These findings do not justify a Firefox retry, readiness controller or timeout change.
