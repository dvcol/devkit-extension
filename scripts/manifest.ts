import type { Manifest } from 'webextension-polyfill';

import fs from 'fs-extra';

import pkg from '../package.json';
import { getDirName, isDev, outDir, port, resolveParent } from './utils';

const Endpoints = {
  Dev: 'http://localhost' as const,
} as const;

function getExtensionPages(_dev: boolean, _port: number) {
  if (_dev && _port) return `script-src 'self' ${Endpoints.Dev}:${_port}; object-src 'self' ${Endpoints.Dev}:${_port}`;
  return "script-src 'self'; object-src 'self'";
}

function getHostPermissions(_dev: boolean, _port: number) {
  const permissions: Manifest.Permission[] = [];
  if (_dev) permissions.push(`${Endpoints.Dev}:${_port}/*`);
  return permissions;
}

export type WebManifest = Manifest.WebExtensionManifest & {
  side_panel: Record<string, string>;
};

export const manifest: WebManifest = {
  manifest_version: 3,
  name: pkg.title || pkg.name,
  version: pkg.version,
  description: pkg.description,
  default_locale: 'en',
  icons: {
    16: 'icons/icon-512.png',
    48: 'icons/icon-512.png',
    128: 'icons/icon-512.png',
  },
  options_ui: {
    page: 'views/options/index.html',
    open_in_tab: true,
  },
  action: {
    default_title: pkg.title || pkg.name,
    default_icon: 'icons/icon-512.png',
    default_popup: 'views/popup/index.html',
  },
  side_panel: {
    default_path: 'views/panel/index.html',
  },
  background: {
    service_worker: 'scripts/background.js',
    type: 'module',
  },
  permissions: ['storage', 'tabs', 'contextMenus', 'sidePanel'],
  web_accessible_resources: [],
  host_permissions: getHostPermissions(isDev, port),
  content_security_policy: {
    // Adds localhost for vite hot reload
    extension_pages: getExtensionPages(isDev, port),
  },
};

export async function writeManifest() {
  fs.ensureDirSync(resolveParent(outDir));
  fs.writeJSONSync(resolveParent(`${outDir}/manifest.json`), manifest, {
    spaces: 2,
  });
  console.info(`Writing manifest.json to '${getDirName()}/${outDir}/manifest.json'`);
}
