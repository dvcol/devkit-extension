import type { UserManifest } from 'wxt';

/** Shared application permissions and page URLs for native development and production builds. */
export function createManifest(firefox: boolean): UserManifest {
  const manifest = {
    name: 'Devkit native Port example',
    version: '0.0.1',
    action: { default_popup: 'panel.html' },
    options_ui: { page: 'panel.html', open_in_tab: true },
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
