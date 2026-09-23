import { expect, test } from 'vitest';
import { defineContribution } from './fixtures/sdk/src/index.js';
test('keeps the contribution identity and value', () => {
  expect.assertions(2);
  const contribution = defineContribution({ id: 'example:probe', value: 7 });
  expect(contribution.id).toBe('example:probe');
  expect(contribution.value).toBe(7);
});
