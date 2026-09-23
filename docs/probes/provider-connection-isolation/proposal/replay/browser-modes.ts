import { options } from './browser-helpers.js';
const requestedMode = new URL(location.href).searchParams.get('mode');
export const mode =
  requestedMode === 'isolated' || requestedMode === 'mixed' ? requestedMode : 'shared';
export const isolatedEndpointB = mode !== 'shared';
export const expectedCounterA = mode === 'shared' ? 7 : 5;
export const expectedCounterB = mode === 'shared' ? 10 : 12;
/** Research-only prototype flag; not an option in the released declaration. */
export function connectionOptions(endpoint: 'endpointA' | 'endpointB') {
  return {
    ...options,
    isolateConnection: mode === 'isolated' || (mode === 'mixed' && endpoint === 'endpointB'),
  };
}
