import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readNativeResponse, startResponseServer } from './response-body.ts';

export async function checkChromiumResponseBody(extension: Page, artifactDirectory: string) {
  await using cleanup = new AsyncDisposableStack();
  const fixture = await startResponseServer();
  cleanup.defer(fixture.close);
  const source = await extension.context().newPage();
  cleanup.defer(() => source.close());
  const errors: string[] = [];
  for (const page of [extension, source]) {
    const onPageError = (error: Error) => errors.push(error.message);
    page.on('pageerror', onPageError);
    cleanup.defer(() => {
      page.off('pageerror', onPageError);
    });
  }
  const provider = await extension.locator('#provider').innerText();
  await source.goto(fixture.url);
  const observation = await checkUnavailableResponse(extension, source);
  assert.equal(await extension.locator('#provider').innerText(), provider);
  assert.deepEqual(errors, []);
  await writeFile(
    `${artifactDirectory}/response-body.json`,
    JSON.stringify(
      {
        browser: extension.context().browser()?.version(),
        checks: [
          'native Firefox response filtering is explicitly unavailable on Chromium and leaves received bytes unchanged',
        ],
        ...observation,
        providerRetained: true,
        pageErrors: errors,
      },
      null,
      2,
    ) + '\n',
  );
}

async function checkUnavailableResponse(extension: Page, source: Page) {
  const original = await source.evaluate(readNativeResponse, '/transform-response/plain');
  assert.deepEqual(original, { status: 200, text: 'original-世界' });
  await extension.locator('#response-install').click();
  await expect(extension.locator('#result')).not.toHaveText('Pending');
  const rejected: unknown = JSON.parse(await extension.locator('#result').innerText());
  assert.partialDeepStrictEqual(rejected, {
    filteringMethodPresent: false,
    admitted: 0,
    completed: 0,
    errors: [],
    installation: {
      id: 'example.response-body',
      contributions: [
        { kind: 'transform', status: 'failed', diagnostics: [{ code: 'setup-failure' }] },
      ],
    },
  });
  assert.deepEqual(
    await source.evaluate(readNativeResponse, '/transform-response/plain'),
    original,
  );
  await extension.locator('#response-dispose').click();
  await expect(extension.locator('#result')).not.toHaveText('Pending');
  const disposed: unknown = JSON.parse(await extension.locator('#result').innerText());
  assert.partialDeepStrictEqual(disposed, {
    filteringMethodPresent: false,
    installation: { contributions: [{ kind: 'transform', status: 'disposed' }] },
  });
  return { original, rejected, disposed };
}
