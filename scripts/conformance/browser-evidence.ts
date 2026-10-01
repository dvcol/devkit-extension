import assert from 'node:assert/strict';

export interface BrowserEvidenceReference {
  readonly workspace: string;
  readonly testFile: string;
  readonly receiptFile: string;
  readonly checks: readonly string[];
  readonly host: string;
  readonly mode: string;
  readonly requirePageErrors: boolean;
}

/** Existing browser scripts write receipts only after their native assertions succeed. */
export function checkBrowserResult(report: unknown, reference: BrowserEvidenceReference) {
  assert.ok(typeof report === 'object' && report !== null, 'Missing browser receipt');
  assert.ok(
    'browser' in report && typeof report.browser === 'string' && report.browser.length > 0,
    'Missing tested browser version',
  );
  assert.ok('checks' in report && Array.isArray(report.checks), 'Missing executed browser checks');
  assert.ok(report.checks.every((check: unknown) => typeof check === 'string'));
  assert.ok(reference.checks.length > 0, 'Empty browser evidence reference');
  assert.equal(
    new Set(reference.checks).size,
    reference.checks.length,
    'Duplicate browser evidence reference',
  );
  for (const check of reference.checks) {
    assert.equal(
      report.checks.filter((executed: unknown) => executed === check).length,
      1,
      `Missing or duplicate executed browser check: ${check}`,
    );
  }
  if ('passed' in report) assert.equal(report.passed, true, 'Failed browser run');
  if (reference.requirePageErrors) assert.ok('pageErrors' in report, 'Missing page-error capture');
  if ('pageErrors' in report) assert.deepEqual(report.pageErrors, [], 'Browser page errors');
  const limitations: unknown = 'limitations' in report ? report.limitations : [];
  assert.ok(Array.isArray(limitations));
  assert.ok(limitations.every((limitation: unknown) => typeof limitation === 'string'));
  return { browser: report.browser, limitations };
}
