import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parseArgs, styleText } from 'node:util';

const require = createRequire(new URL('../../../examples/webext/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const { values } = parseArgs({
  options: { bundle: { type: 'string' }, candidate: { type: 'boolean', default: false } },
});
const bundlePath = values.bundle ?? require.resolve('@devframes/json-render-ui/renderer');
let bundle = await readFile(bundlePath, 'utf8');
const document = await readFile(new URL('./index.html', import.meta.url), 'utf8');

/** Diagnosis only: mutate the served copy, never the installed dependency. */
if (values.candidate) {
  const original = '\t\t\tr[t] = !0;\n\t\t\ttry {\n\t\t\t\treturn await e.call(t, a);';
  assert.equal(bundle.split(original).length, 2, 'Expected exactly one 1.0.0 action bridge');
  bundle = bundle.replace(original, '\t\t\tif (i.value?.action === t) i.value = null;\n' + original);
}

const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('http://renderer.test/**', (route) => {
    const isBundle = new URL(route.request().url()).pathname === '/renderer.mjs';
    return route.fulfill({
      contentType: isBundle ? 'text/javascript' : 'text/html',
      body: isBundle ? bundle : document,
    });
  });
  await page.goto('http://renderer.test/');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Handled failure', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('Action "example.retry" failed: First attempt failed');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Succeeded', { exact: true })).toBeVisible();
  await expect(page.locator('#calls')).toHaveText('2');
  assert.deepEqual(errors, []);
  console.info(styleText('cyan', '🔎 [renderer-error]'), {
    browser: browser.version(),
    candidate: values.candidate,
    calls: 2,
    applicationStatus: 'Succeeded',
    bannerAfterSuccess: await page.getByRole('alert').allTextContents(),
    pageErrors: errors,
  });
  await expect(page.getByRole('alert')).toHaveCount(0, { timeout: 1000 });
} finally {
  await browser.close();
}
