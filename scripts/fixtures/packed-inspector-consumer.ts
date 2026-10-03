import { packedInspectorBrowser, packedInspectorHtml } from './packed-inspector-browser.ts';
import { packedInspectorDriver } from './packed-inspector-driver.ts';
import { packedInspectorHosts } from './packed-inspector-hosts.ts';

/** These sources are compiled and executed only after the isolated tarball installation. */
export const packedInspectorFiles = {
  'packed-browser.ts': packedInspectorBrowser,
  'packed-hosts.ts': packedInspectorHosts,
  'packed-driver.ts': packedInspectorDriver,
  'index.html': packedInspectorHtml,
};
