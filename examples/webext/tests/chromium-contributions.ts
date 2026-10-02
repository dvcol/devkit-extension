import type { Page } from '@playwright/test';
import { checkScriptTiming } from './chromium-script-timing.ts';
import { checkChromiumHeaderRules } from './chromium-header-rules.ts';
import { checkChromiumRedirectRules } from './chromium-redirect-rules.ts';

/** Run the independent native contribution scenarios in production and WXT development. */
export async function checkChromiumContributions(extension: Page, artifactDirectory: string) {
  await checkScriptTiming(extension, artifactDirectory);
  await checkChromiumHeaderRules(extension, artifactDirectory);
  await checkChromiumRedirectRules(extension, artifactDirectory);
}
