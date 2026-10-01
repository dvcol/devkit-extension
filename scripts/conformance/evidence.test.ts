import { describe, expect, it } from 'vitest';
import { checkInventory, checkTestResult } from './evidence.ts';
import type { CoverageGroup } from './evidence.ts';

const reference = {
  workspace: 'packages/core',
  testFile: 'tests/definitions.test.ts',
  fullName: 'portable definitions keeps declarations inert',
  host: 'node',
  mode: 'unit',
};
const group: CoverageGroup = {
  id: 'declarations',
  apis: ['@fixture/api:Client.dispose'],
  examples: ['examples/contribution'],
  evidence: [reference],
  gaps: ['Native hosts remain unverified'],
};
const testFile = '/repository/packages/core/tests/definitions.test.ts';

function report(status: string, fullName = reference.fullName) {
  return {
    success: true,
    testResults: [{ name: testFile, assertionResults: [{ fullName, status }] }],
  };
}

describe('API evidence gates', () => {
  it('rejects missing, obsolete, duplicate and unclassified API entries', () => {
    expect.assertions(7);
    expect(() => {
      checkInventory(group.apis, [group]);
    }).not.toThrow();
    expect(() => {
      checkInventory([...group.apis, '@fixture/api:Client.enable'], [group]);
    }).toThrow('Review changed API');
    expect(() => {
      checkInventory([], [group]);
    }).toThrow('Review changed API');
    expect(() => {
      checkInventory(group.apis, [group, group]);
    }).toThrow('Duplicate API');
    expect(() => {
      checkInventory(group.apis, [{ ...group, evidence: [], gaps: [] }]);
    }).toThrow('Unclassified');
    expect(() => {
      checkInventory(group.apis, [{ ...group, examples: [] }]);
    }).toThrow('Missing example');
    expect(() => {
      checkInventory([], [{ ...group, apis: [] }]);
    }).toThrow('Empty API group');
  });

  it('requires the exact executed test to pass, rejecting skipped, todo, failed and absent results', () => {
    expect.assertions(8);
    expect(() => {
      checkTestResult(report('passed'), reference, testFile);
    }).not.toThrow();
    for (const status of ['pending', 'skipped', 'todo', 'failed']) {
      expect(() => {
        checkTestResult(report(status), reference, testFile);
      }).toThrow('Test did not pass');
    }
    expect(() => {
      checkTestResult(report('passed', 'different test'), reference, testFile);
    }).toThrow('Missing or duplicate executed test');
    expect(() => {
      checkTestResult(report('passed'), reference, '/different/file.ts');
    }).toThrow('Missing or duplicate executed suite');
    expect(() => {
      checkTestResult({ ...report('passed'), success: false }, reference, testFile);
    }).toThrow('Failed test run');
  });

  it('rejects duplicate suite and test results instead of choosing one', () => {
    expect.assertions(2);
    const executed = { fullName: reference.fullName, status: 'passed' };
    const suite = { name: testFile, assertionResults: [executed] };
    expect(() => {
      checkTestResult({ success: true, testResults: [suite, suite] }, reference, testFile);
    }).toThrow('Missing or duplicate executed suite');
    expect(() => {
      checkTestResult(
        { success: true, testResults: [{ ...suite, assertionResults: [executed, executed] }] },
        reference,
        testFile,
      );
    }).toThrow('Missing or duplicate executed test');
  });
});
