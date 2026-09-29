import { defineConfig } from 'wxt';
export default defineConfig({ imports: false, manifest: { name: 'Strict declaration gate', version: '0.0.0', permissions: ['storage'] }, webExt: { disabled: true } });
