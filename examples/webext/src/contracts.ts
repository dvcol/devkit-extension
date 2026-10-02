import { defineRealm } from '@devkit/core';

export {
  counterCapability,
  counterStateKey,
  increaseCounterAction,
  increaseMatchingCounterAction,
} from '@devkit/example-contribution';
export const realm = defineRealm({ id: 'webext' });
export const providerId = 'example.extension';
