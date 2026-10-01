import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { styleText } from 'node:util';
import matrix from '../docs/contracts/api-coverage.json' with { type: 'json' };
import { checkInventory, checkTestResult } from './conformance/evidence.ts';
import type { CoverageGroup, EvidenceReference } from './conformance/evidence.ts';
import { declarationEntries, discoverApi } from './conformance/inventory.ts';

const repository = resolve(import.meta.dirname, '..');
const groups: readonly CoverageGroup[] = matrix.groups;

async function verifyEvidence(reference: EvidenceReference) {
  const testFile = join(repository, reference.workspace, reference.testFile);
  await access(testFile);
  const reportFile = join(repository, reference.workspace, '.conformance/vitest.json');
  const report: unknown = JSON.parse(await readFile(reportFile, 'utf8'));
  checkTestResult(report, reference, testFile);
  assert.ok(typeof report === 'object' && report !== null && 'startTime' in report);
  assert.ok(typeof report.startTime === 'number' && Number.isFinite(report.startTime));
  return { ...reference, result: 'passed', runStartedAt: new Date(report.startTime).toISOString() };
}

async function verifyCoverage(discovered: readonly string[]): Promise<void> {
  assert.equal(matrix.schemaVersion, 1, 'Unsupported API coverage schema');
  checkInventory(discovered, groups);
  const results = [];
  for (const group of groups) {
    for (const example of group.examples) await access(join(repository, example, 'package.json'));
    const evidence = [];
    for (const reference of group.evidence) evidence.push(await verifyEvidence(reference));
    results.push({ ...group, evidence });
  }
  const incomplete = results.filter((group) => group.gaps.length > 0);
  const outputDirectory = join(repository, '.conformance');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, 'report.json'),
    `${JSON.stringify(
      {
        schemaVersion: matrix.schemaVersion,
        checkedAt: new Date().toISOString(),
        complete: incomplete.length === 0,
        apiCount: discovered.length,
        groups: results,
      },
      null,
      2,
    )}\n`,
  );
  console.info(
    styleText('cyan', '🧪 [conformance]'),
    `${discovered.length} API paths accounted for; ${results.reduce((count, group) => count + group.evidence.length, 0)} executed test references verified; ${incomplete.length} groups retain coverage gaps.`,
    'Report: .conformance/report.json',
  );
  if (process.argv.includes('--complete')) {
    assert.deepEqual(
      incomplete.map((group) => group.id),
      [],
      'Release conformance remains incomplete',
    );
  }
}

const discovered = discoverApi(await declarationEntries(repository), join(repository, 'packages'));
if (process.argv.includes('--inventory')) {
  console.info(JSON.stringify(discovered, null, 2));
} else {
  await verifyCoverage(discovered);
}
