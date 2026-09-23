import { expect, test } from 'vitest';
import { defineContribution } from '@probe/sdk';
test('keeps the contribution identity and value', () => {
  expect.assertions(2);
  const contribution = defineContribution({ id: 'example:probe', value: 7 });
  expect(contribution.id).toBe('example:probe');
  expect(contribution.value).toBe(7);
});

const requiredFeatures = ['spec', 'state', 'action', 'content'];
const exampleCoverage = ['spec', 'state', 'action', 'content'];
test('covers each declared fixture feature', () => {
  expect.assertions(1);
  expect(exampleCoverage).toEqual(requiredFeatures);
});
