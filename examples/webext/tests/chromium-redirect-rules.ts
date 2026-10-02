import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  checkNativeRedirectRules,
  readNativeRedirects,
  startRedirectServer,
} from './redirect-rules.ts';

export async function checkChromiumRedirectRules(extension: Page, artifactDirectory: string) {
  await using cleanup = new AsyncDisposableStack();
  const fixture = await startRedirectServer();
  cleanup.defer(fixture.close);
  const source = await extension.context().newPage();
  cleanup.defer(() => source.close());
  const pageErrors: string[] = [];
  const collectPageError = (error: Error) => pageErrors.push(error.message);
  for (const page of [extension, source]) {
    page.on('pageerror', collectPageError);
    cleanup.defer(() => {
      page.off('pageerror', collectPageError);
    });
  }
  await source.goto(fixture.url);
  const provider = await extension.locator('#provider').innerText();
  const observation = await checkNativeRedirectRules({
    control: async (identifier) => {
      await extension.locator(`#${identifier}`).click();
      await expect(extension.locator('#result')).not.toHaveText('Pending');
      const snapshot: unknown = JSON.parse(await extension.locator('#result').innerText());
      return snapshot;
    },
    observe: () => source.evaluate(readNativeRedirects),
    requests: fixture.requests,
  });
  assert.equal(await extension.locator('#provider').innerText(), provider);
  assert.deepEqual(pageErrors, []);
  await writeFile(
    `${artifactDirectory}/redirect-rules.json`,
    JSON.stringify(
      {
        browser: extension.context().browser()?.version(),
        checks: observation.checks,
        observation,
        serverRequests: fixture.requests,
        providerRetained: true,
        pageErrors,
      },
      null,
      2,
    ) + '\n',
  );
}
