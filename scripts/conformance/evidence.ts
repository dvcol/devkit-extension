import assert from 'node:assert/strict';

export interface EvidenceReference {
  readonly workspace: string;
  readonly testFile: string;
  readonly fullName: string;
  readonly host: string;
  readonly mode: string;
}

export interface CoverageGroup {
  readonly id: string;
  readonly apis: readonly string[];
  readonly examples: readonly string[];
  readonly evidence: readonly EvidenceReference[];
  readonly gaps: readonly string[];
}

/** Every discovered path must be explicitly classified, even when its coverage is still missing. */
export function checkInventory(
  discovered: readonly string[],
  groups: readonly CoverageGroup[],
): void {
  const recorded = groups.flatMap((group) => group.apis);
  assert.equal(new Set(recorded).size, recorded.length, 'Duplicate API inventory entries');
  assert.equal(
    new Set(groups.map((group) => group.id)).size,
    groups.length,
    'Duplicate coverage group IDs',
  );
  const added = discovered.filter((item) => !recorded.includes(item));
  const removed = recorded.filter((item) => !discovered.includes(item));
  assert.deepEqual(
    { added, removed },
    { added: [], removed: [] },
    'Review changed API coverage entries',
  );
  for (const group of groups) {
    assert.ok(group.apis.length > 0, `Empty API group: ${group.id}`);
    assert.ok(
      group.evidence.length > 0 || group.gaps.length > 0,
      `Unclassified API group: ${group.id}`,
    );
    if (group.evidence.length > 0)
      assert.ok(group.examples.length > 0, `Missing example: ${group.id}`);
  }
}

/** Reads the native Vitest JSON result. Test source text and a suite's overall status are not proof. */
export function checkTestResult(
  report: unknown,
  reference: EvidenceReference,
  testFile: string,
): void {
  assert.ok(typeof report === 'object' && report !== null && 'testResults' in report);
  assert.ok(
    'success' in report && report.success === true,
    `Failed test run: ${reference.workspace}`,
  );
  assert.ok(Array.isArray(report.testResults));
  const matches: unknown[] = report.testResults.filter(
    (suite: unknown) =>
      typeof suite === 'object' && suite !== null && 'name' in suite && suite.name === testFile,
  );
  assert.equal(matches.length, 1, `Missing or duplicate executed suite: ${reference.testFile}`);
  const suite = matches[0];
  assert.ok(typeof suite === 'object' && suite !== null && 'assertionResults' in suite);
  assert.ok(Array.isArray(suite.assertionResults));
  const results: unknown[] = suite.assertionResults.filter(
    (result: unknown) =>
      typeof result === 'object' &&
      result !== null &&
      'fullName' in result &&
      result.fullName === reference.fullName,
  );
  assert.equal(results.length, 1, `Missing or duplicate executed test: ${reference.fullName}`);
  const result = results[0];
  assert.ok(typeof result === 'object' && result !== null && 'status' in result);
  assert.equal(result.status, 'passed', `Test did not pass: ${reference.fullName}`);
}
