/** Shared contracts contain no provider handlers, host resources, or runtime implementation. */
export {
  counterCapability,
  increaseCounterAction,
  increaseMatchingCounterAction,
} from './contracts.js';

/** Native host-owned counter data; published views only project this state. */
export const counterStateKey = 'example:server-counter';
