# Frozen native cache diagnosis

Executed September 29, 2026 against application source at `96ace4a`, before the cache configuration correction. WXT 0.21.4, Vite 8.3.0, Chromium 153.0.8010.12 and Firefox 156.0.1 used the installed workspace dependency graph. These are frozen diagnostic scripts, not maintained package tests. Their absolute paths identify the checkout and temporary experiment directory used for this run.

The scripts copy the maintained example into separate temporary roots, sharing its installed `node_modules` through the existing fixture helper. They start both browsers concurrently and perform startup plus nine native configuration restarts. Every iteration opens the actual panel, waits for `Connected`, observes native counter state where implemented, and obtains a fresh caller identity. Cleanup stops the owned native browser/server and removes the copied application/profile. The Python runner starts both Node processes together.

The retained scripts show the second run, with the only experiment variable set through native Vite `cacheDir` to each temporary root's `.wxt/vite-cache`. The preceding shared-cache run omitted that `vite` property. It failed on Chromium's first restart with a 504 for the optimized renderer module; Firefox completed all ten observations. The isolated run completed ten observations per browser without captured failures.

The first attempt to construct the probe used an unavailable `Browser.waitForEvent` method and was corrected to the existing `isConnected` polling pattern before either retained comparison. That scripting error is not product evidence.

Receipts preserve actual URLs, DOM, identities and errors. Do not format or silently reinterpret them. The maintained concurrent acceptance command is now `pnpm --filter @devkit/example-webext test:dev`; CI runs it. See [the diagnosis and scope](../../research/native-development-cache.md).
