import { defineRealm } from '@devkit/core';

export { counterCapability, increaseCounterAction } from '@devkit/example-contribution';
export const realm = defineRealm({ id: 'webext' });
export const providerId = 'example.extension';
