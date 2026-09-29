import assert from 'node:assert/strict';
import { styleText } from 'node:util';
import type { Driver } from 'selenium-webdriver/firefox.js';
import { nativeSurfaceScript } from './native-surfaces.ts';
import { checkFirefoxDevtools } from './firefox-devtools.ts';
import { checkFirefoxSidebar } from './firefox-sidebar.ts';

/** Exercise native hosts in sequence against the surviving options page and background provider. */
export async function checkFirefoxHosts(driver: Driver): Promise<string[]> {
  console.info(styleText('cyan', '🧪 [webext/firefox/hosts]'), 'Opening native popup and options');
  await driver.manage().setTimeouts({ script: 60_000 });
  const result = await driver.executeAsyncScript<{ checks?: string[]; error?: string }>(
    `const done = arguments[arguments.length - 1]; ${nativeSurfaceScript}
checkNativeSurfaces().then(checks => done({ checks }), error => done({ error: error.stack ?? String(error) }));`,
  );
  assert.equal(result.error, undefined);
  assert.ok(result.checks !== undefined);
  console.info(styleText('cyan', '🧪 [webext/firefox/hosts]'), 'Opening native DevTools');
  const devtools = await checkFirefoxDevtools(driver);
  console.info(styleText('cyan', '🧪 [webext/firefox/hosts]'), 'Opening native sidebar');
  return [...result.checks, ...devtools, ...(await checkFirefoxSidebar(driver))];
}
