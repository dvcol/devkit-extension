import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';
import { createManifest } from './manifest.ts';

const chromiumProfile = resolve(import.meta.dirname, '.wxt/chromium-profile');

export default defineConfig({
  imports: false,
  manifestVersion: 3,
  manifest: ({ browser }) => createManifest(browser === 'firefox'),
  hooks: {
    /** web-ext requires a persistent profile directory to exist before opening Chrome. */
    'server:created': async () => {
      await mkdir(chromiumProfile, { recursive: true });
    },
  },
  dev: { server: { host: '127.0.0.1', origin: 'http://127.0.0.1' } },
  webExt: {
    /** Chrome must save Developer mode once in this dedicated native development profile. */
    chromiumProfile,
    keepProfileChanges: true,
  },
});
