import { checkChromiumResponseBody } from './chromium-response-body.ts';
import type { Page } from '@playwright/test';
import { checkScriptTiming } from './chromium-script-timing.ts';
import { checkChromiumScriptContexts } from './chromium-script-contexts.ts';
import { checkChromiumScriptStages } from './chromium-script-stages.ts';
import { checkChromiumHeaderRules } from './chromium-header-rules.ts';
import { checkChromiumRedirectRules } from './chromium-redirect-rules.ts';

/** Run the independent native contribution scenarios in production and WXT development. */
export async function checkChromiumContributions(extension: Page, artifactDirectory: string) {
  await checkScriptTiming(extension, artifactDirectory);
  await checkChromiumScriptContexts(extension, artifactDirectory);
  await checkChromiumScriptStages(extension, artifactDirectory);
  await checkChromiumHeaderRules(extension, artifactDirectory);
  await checkChromiumRedirectRules(extension, artifactDirectory);
  await checkChromiumResponseBody(extension, artifactDirectory);
}
