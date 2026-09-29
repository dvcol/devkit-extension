import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';
import type { UserManifest } from 'wxt';

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

/** Shared application permissions and page URLs for native development and production builds. */
export function createManifest(firefox: boolean): UserManifest {
  const manifest = {
    name: 'Devkit native Port example',
    version: '0.0.1',
    action: { default_popup: 'panel.html' },
    options_ui: { page: 'panel.html', open_in_tab: true },
    devtools_page: 'devtools.html',
    host_permissions: ['http://127.0.0.1/*'],
    permissions: ['scripting'],
    /** Allow loopback WebSockets without Firefox's default insecure-request upgrade. */
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'none'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
    },
  } satisfies UserManifest;
  if (!firefox) return manifest;
  return {
    ...manifest,
    browser_specific_settings: {
      gecko: {
        id: 'devkit-native-port@example.invalid',
        data_collection_permissions: { required: ['none'] },
      },
    },
  };
}
