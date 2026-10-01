import { describe, expect, it } from 'vitest';
import { checkBrowserResult } from './browser-evidence.ts';

const reference = {
  workspace: 'examples/webext',
  testFile: 'tests/browser.ts',
  receiptFile: 'artifacts/receipt.json',
  checks: ['two real Ports', 'pending call rejects on disconnect'],
  host: 'chromium-webext',
  mode: 'production',
  requirePageErrors: true,
};
const receipt = {
  browser: '153.0.8010.12',
  checks: reference.checks,
  pageErrors: [],
};

describe('native browser evidence', () => {
  it('retains the tested version and limitations without inventing missing page-error capture', () => {
    expect.assertions(2);
    expect(checkBrowserResult(receipt, reference)).toEqual({
      browser: receipt.browser,
      limitations: [],
    });
    const limitations = ['No global page-error capture through WebDriver Classic'];
    expect(
      checkBrowserResult(
        { browser: '157.0', checks: reference.checks, limitations },
        { ...reference, requirePageErrors: false },
      ),
    ).toEqual({ browser: '157.0', limitations });
  });

  it('rejects absent, duplicate, failed and malformed execution evidence', () => {
    expect.assertions(9);
    const invalidReceipts = [
      null,
      { ...receipt, browser: '' },
      { ...receipt, checks: [] },
      { ...receipt, checks: [...reference.checks, reference.checks[0]] },
      { ...receipt, passed: false },
      { ...receipt, pageErrors: ['Uncaught error'] },
      { ...receipt, limitations: 'Unsupported proof' },
      { ...receipt, checks: [true, ...reference.checks] },
      { browser: receipt.browser, checks: reference.checks },
    ];
    for (const invalid of invalidReceipts) {
      expect(() => checkBrowserResult(invalid, reference)).toThrow(/.+/u);
    }
  });

  it('requires a nonempty exact scenario selection without duplicate claims', () => {
    expect.assertions(3);
    expect(() => checkBrowserResult(receipt, { ...reference, checks: [] })).toThrow('Empty');
    expect(() =>
      checkBrowserResult(receipt, { ...reference, checks: ['renamed scenario'] }),
    ).toThrow('Missing or duplicate executed browser check');
    expect(() =>
      checkBrowserResult(receipt, {
        ...reference,
        checks: [...reference.checks, ...reference.checks],
      }),
    ).toThrow('Duplicate browser evidence reference');
  });
});
