import type { Driver } from 'selenium-webdriver/firefox.js';
import { checkFirefoxContributions } from './firefox-contributions.ts';
import { checkFirefoxDevtoolsDevelopment } from './firefox-devtools-development.ts';
import { checkFirefoxPopupDevelopment } from './firefox-popup-development.ts';
import { checkFirefoxSidebarDevelopment } from './firefox-sidebar-development.ts';

/** Check native hosts before the development fixture replaces its background provider. */
export async function checkFirefoxDevelopmentHosts(driver: Driver, fixture: string): Promise<void> {
  await checkFirefoxContributions(driver, 'artifacts/firefox-development');
  await checkFirefoxPopupDevelopment(driver, fixture);
  await checkFirefoxDevtoolsDevelopment(driver, fixture);
  await checkFirefoxSidebarDevelopment(driver, fixture);
}
