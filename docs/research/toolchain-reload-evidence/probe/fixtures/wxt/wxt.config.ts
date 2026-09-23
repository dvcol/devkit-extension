import { defineConfig } from 'wxt';
export default defineConfig({
  imports: false,
  manifest: { name: 'Toolchain probe', version: '0.0.0', permissions: ['storage'], host_permissions: ['http://127.0.0.1/*'], browser_specific_settings: { gecko: { id: 'toolchain-probe@example.invalid' } } },
  webExt: { disabled: true },
});
