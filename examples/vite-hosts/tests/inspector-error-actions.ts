import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export interface ResponseFailure {
  active: boolean;
  requests: number;
}

/** Reject a genuine server fetch at its HTTP boundary, retaining the authored inspector actions. */
export async function checkInspectorError(options: {
  page: Page;
  failure: ResponseFailure;
  renderer: 'reference' | 'custom';
}) {
  const { page, failure, renderer } = options;
  await page.locator('#inspector-renderer').selectOption(renderer);
  await expect(page.locator('#inspector button')).toHaveCount(5);
  await action(page, 'Enable response modification', 'Configuration dispatch complete');
  await action(page, 'Inspect response', 'Inspection dispatch complete');
  await expect(page.locator('#inspector')).toContainText('Response body: native:fixture:original');
  const provider = await page.locator('#provider').innerText();
  const mount = await page.locator('#inspector > div').elementHandle();
  assert.ok(mount !== null);
  try {
    const before = await state(page);
    failure.active = true;
    const initialRequests = failure.requests;
    await action(page, 'Inspect response', 'Inspection failed');
    assert.ok(
      failure.requests > initialRequests,
      'The real backend attempted the failing HTTP read',
    );
    const failed = await state(page);
    assert.equal(failed.body, before.body);
    assert.equal(failed.configuration, before.configuration);
    assert.equal(failed.document, before.document);
    assert.match(failed.alert, /Operation handler failed/u);
    const recovery = await checkRecovery(page, failure);
    assert.equal(recovery.document, before.document);
    assert.equal(await page.locator('#provider').innerText(), provider);
    assert.equal(
      await mount.evaluate((element) => element === document.querySelector('#inspector > div')),
      true,
    );
    return {
      renderer,
      provider: JSON.parse(provider) as unknown,
      before,
      failed,
      recovery,
      failedRequests: failure.requests - initialRequests,
    };
  } finally {
    failure.active = false;
    await mount.dispose();
  }
}

async function action(page: Page, label: string, outcome: string): Promise<void> {
  await page.locator('#inspector').getByRole('button', { name: label, exact: true }).click();
  await expect(page.locator('#inspector').getByText(outcome, { exact: true })).toBeVisible();
}

async function state(page: Page) {
  return {
    body: await page
      .locator('#inspector')
      .getByText(/^Response body:/u)
      .innerText(),
    configuration: await page
      .locator('#inspector')
      .getByText(/^Modification enabled:/u)
      .innerText(),
    alert: await page
      .locator('#inspector [role="alert"]')
      .allTextContents()
      .then((messages) => messages.join('\n')),
    outcome: await page
      .locator('#inspector')
      .getByText(/^(Inspection|Configuration|Reset|Marker) (dispatch complete|failed)$/u)
      .innerText(),
    document: await page.evaluate(() => performance.timeOrigin),
  };
}

async function checkRecovery(page: Page, failure: ResponseFailure) {
  failure.active = false;
  await action(page, 'Reset inspector', 'Reset dispatch complete');
  await expect(page.locator('#inspector')).toContainText('Response body: No response inspected');
  await expect(page.locator('#inspector')).toContainText('Modification enabled: false');
  await action(page, 'Inspect response', 'Inspection dispatch complete');
  await expect(page.locator('#inspector')).toContainText('Response body: fixture:original');
  const recovered = await state(page);
  assert.equal(recovered.alert, '');
  await expect(page.locator('#inspector button:disabled')).toHaveCount(0);
  return recovered;
}
