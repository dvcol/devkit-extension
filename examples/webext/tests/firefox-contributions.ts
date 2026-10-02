import type { Driver } from 'selenium-webdriver/firefox.js';
import { checkFirefoxScriptTiming } from './firefox-script-timing.ts';
import { checkFirefoxHeaderRules } from './firefox-header-rules.ts';
import { checkFirefoxRedirectRules } from './firefox-redirect-rules.ts';

/** Run the independent native contribution scenarios in production and WXT development. */
export async function checkFirefoxContributions(driver: Driver, artifactDirectory: string) {
  await checkFirefoxScriptTiming(driver, artifactDirectory);
  await checkFirefoxHeaderRules(driver, artifactDirectory);
  await checkFirefoxRedirectRules(driver, artifactDirectory);
}
