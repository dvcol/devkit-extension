import type { Page } from '@playwright/test';
import { nativeSurfaceScript } from './native-surfaces.ts';
import { checkChromiumDevtools } from './chromium-devtools.ts';
import { checkChromiumSidebar } from './chromium-sidebar.ts';
import { checkChromiumWorker } from './chromium-worker.ts';

/** Exercise native hosts in sequence against the surviving options page and background provider. */
export async function checkChromiumHosts(options: Page, peer: Page): Promise<string[]> {
  return [
    ...(await options.evaluate<string[]>(
      `"use strict";\n${nativeSurfaceScript}\ncheckNativeSurfaces()`,
    )),
    ...(await checkChromiumDevtools(options)),
    ...(await checkChromiumSidebar(options)),
    ...(await checkChromiumWorker(options, peer)),
  ];
}
