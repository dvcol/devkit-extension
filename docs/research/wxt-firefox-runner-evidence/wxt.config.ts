import { defineConfig } from 'wxt';
export default defineConfig({
  imports: false,
  manifest: {
    name: 'Managed Firefox lifecycle proof', version: '1.0.1',
    browser_specific_settings: { gecko: { id: "managed-wxt-firefox@example.invalid", data_collection_permissions: { required: ['none'] } } },
  },
  dev: { server: { host: '127.0.0.1', port: 63314 } },
  webExt: {
    binaries: { firefox: "/Applications/Firefox.app/Contents/MacOS/firefox" },
    firefoxArgs: ['--headless', '--marionette', '--remote-allow-system-access'],
    firefoxPref: {
      'marionette.port': 63313,
    },
  },
});
