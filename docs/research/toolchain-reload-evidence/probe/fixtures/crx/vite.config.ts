import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
const firefox = process.env.PROBE_BROWSER === 'firefox';
const background = firefox ? { scripts: ['background.ts'], type: 'module' } : { service_worker: 'background.ts', type: 'module' };
export default defineConfig({ plugins: [crx({
  browser: firefox ? 'firefox' : 'chrome',
  manifest: { manifest_version: 3, name: 'CRX probe', version: '0.0.0', background, action: { default_popup: 'popup.html' }, content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.ts'] }] },
})] });
