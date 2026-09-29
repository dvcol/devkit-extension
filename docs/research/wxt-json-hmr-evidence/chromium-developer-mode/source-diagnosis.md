# Chromium native WXT background reload diagnosis

Read-only source review on 2026-09-29. The observed failure is in WXT 0.21.4 / web-ext 10.7.0 / Chrome for Testing 153.0.8010.12. No new browser experiment was run by this reviewer. The original receipt is `/private/tmp/devkit-wxt-json-hmr-replay-r0ktbas2/reload-receipt.json`.

## What the existing evidence establishes

The background update reaches Chrome: the original service worker and both extension pages close. A fresh navigation to the same extension ID fails with `ERR_BLOCKED_BY_CLIENT` on 21 attempts across ten seconds. That proves loss of the loaded extension context, not why Chrome rejected or disabled the replacement. The receipt does not capture the extension registry, effective Developer mode preference, or before/after manifest bytes.

## Installed source path

All local paths below are relative to `/private/tmp/devkit-wxt-json-hmr-replay-r0ktbas2/node_modules/`.

- `wxt/dist/core/utils/create-file-reloader.mjs:59`: after a completed rebuild, an extension change invokes `server.reloadExtension()` and immediately logs success.
- `wxt/dist/core/create-server.mjs:97`: this only broadcasts `wxt:reload-extension`.
- `wxt/dist/virtual/background-entrypoint.mjs:135`: the background listener calls `browser.runtime.reload()`.
- `wxt/dist/core/runners/web-ext.mjs:40`: WXT passes `noReload: true` to web-ext. Its background update does not use web-ext's reload manager.
- `web-ext/lib/extension-runners/chromium.js:376`: web-ext's own `reloadAllExtensions()` instead repeats public CDP `Extensions.loadUnpacked`. Initial loading also uses that command at line 348.

Therefore the WXT success log acknowledges dispatch, not successful browser reactivation. Replacing WXT lifecycle with custom SDK orchestration is not justified by this evidence.

## Exact Chromium source: conditional Developer mode explanation

These references were fetched successfully from the **153.0.8010.12 tag**, not inferred from current `main`:

1. [extensions_handler.cc, line 232](https://github.com/chromium/chromium/blob/153.0.8010.12/chrome/browser/devtools/protocol/extensions_handler.cc#L232): CDP installation calls `set_installed_via_cdp(true)`.
2. [unpacked_installer.cc, lines 301–303](https://github.com/chromium/chromium/blob/153.0.8010.12/extensions/browser/unpacked_installer.cc#L301): that becomes the `INSTALLED_VIA_CDP` creation flag. [unpacked_installer.h, line 207](https://github.com/chromium/chromium/blob/153.0.8010.12/extensions/browser/unpacked_installer.h#L207) initializes it to false.
3. [chrome_extension_registrar_delegate.cc, lines 264–293](https://github.com/chromium/chromium/blob/153.0.8010.12/chrome/browser/extensions/chrome_extension_registrar_delegate.cc#L264): ordinary unpacked reload creates a new installer and loads the path without setting the CDP flag.
4. [extension_management.cc, lines 375–394](https://github.com/chromium/chromium/blob/153.0.8010.12/chrome/browser/extensions/extension_management.cc#L375): when `kExtensionDisableUnsupportedDeveloper` is enabled, an unpacked extension needs either that flag or the running profile's `extensions.ui.developer_mode` value to be true.
5. [standard_management_policy_provider.cc, lines 229–233](https://github.com/chromium/chromium/blob/153.0.8010.12/chrome/browser/extensions/standard_management_policy_provider.cc#L229): failure yields `DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION`. [disable_reason.h, lines 60–62](https://github.com/chromium/chromium/blob/153.0.8010.12/extensions/browser/disable_reason.h#L60) defines its value as `1 << 24` (16777216).
6. [extension_registrar.cc, lines 1200–1203](https://github.com/chromium/chromium/blob/153.0.8010.12/extensions/browser/extension_registrar.cc#L1200): the old extension is disabled before attempting reload, explaining why closed pages alone do not prove replacement success.

This is a concrete **conditional hypothesis**, not a confirmed cause. web-ext's installed `chromium.js:27` already defaults `extensions.ui.developer_mode` to true; `getPrefs():589` merges custom preferences over it. WXT forwards its public `webExt.chromiumPref` at `web-ext.mjs:35`. chrome-launcher 1.2.0 writes the preference object into the disposable profile's `Default/Preferences` before launching (`dist/chrome-launcher.js:145–183`). A written preference is not evidence of its effective value inside Chrome. If the running value is true, this Developer mode explanation is falsified for that run.

## Manifest question

`wxt/dist/core/utils/building/rebuild.mjs:35–43` regenerates the manifest on every rebuild; `wxt/dist/core/utils/manifest.mjs:14–17` writes only if the serialized content differs. A background body-only change does not by itself require a manifest change. No before-manifest receipt exists in the inspected evidence, so byte equality remains unmeasured. Capture both bytes/hashes around the next isolated background-only update.

## Smallest discriminating experiment and native correction

Use the planned generic scratch fixture, leaving maintained `panel.ts` alone. Record the actual Developer mode switch/state from the owned `chrome://extensions` page, public CDP [Extensions.getExtensions](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/#method-getExtensions), and manifest bytes before/after the existing WXT background-only reload. Capture the extension UI's disabled/error details if the registry changes to disabled or disappears.

- If Developer mode is false and the disable reason is 16777216, repeat once after enabling Developer mode in that isolated profile. A passing native WXT `runtime.reload()` then identifies a runner/profile-preference defect; the smallest correction belongs in native profile initialization, not SDK recovery code. Explicit `webExt.chromiumPref: { 'extensions.ui.developer_mode': true }` is already equivalent to web-ext's default and is not an established fix.
- If Developer mode is true, retain that falsification. Use the extension UI's actual load error and manifest comparison to distinguish parsing/loading failure from policy disablement. Do not assume CDP-installed extensions universally cannot call `runtime.reload()`.
- A subsequent public CDP `Extensions.loadUnpacked` can independently report a manifest load error or demonstrate that the unchanged output still loads. That is a diagnostic comparison, not a proposal to replace WXT's normal reload path.

No browser flags that disable security checks, package patches, maintained file changes, or dependency changes were made or recommended as the first correction.
