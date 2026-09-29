import { defineConfig } from 'wxt';
export default defineConfig({
  imports: false,
  manifest: {
    name: 'Native Firefox JSON renderer HMR proof', version: '1.0.0',
    action: { default_popup: 'panel.html' },
    permissions: ['scripting'], host_permissions: ['http://127.0.0.1/*'],
    browser_specific_settings: { gecko: { id: "managed-wxt-firefox-json-hmr@example.invalid", data_collection_permissions: { required: ['none'] } } },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*" },
  },
  vite: () => ({ server: { fs: { allow: ["/private/tmp/devkit-wxt-firefox-json-hmr-4azlFV", "/Users/dinh-van.colomban/Workspace/private/devkit-extension"] } } }),
  dev: { server: { host: '127.0.0.1', origin: 'http://127.0.0.1', port: 49866 } },
  webExt: {
    binaries: { firefox: "/Applications/Firefox.app/Contents/MacOS/firefox" },
    firefoxArgs: ['--headless', '--marionette', '--remote-allow-system-access'],
    firefoxPref: { 'marionette.port': 49865 },
  },
});
