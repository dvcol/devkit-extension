import type { DevframeNodeContext } from 'devframe';
import { createStorage } from 'devframe/node';
import { z } from 'zod';
import { counterStateKey } from './state-key.js';

const savedCounter = z.strictObject({ value: z.number().int() });

/** The host owns one native store; its caller owns the file and chooses when it can be removed. */
export async function publishCounterStorage(context: DevframeNodeContext, filepath: string) {
  await context.rpc.sharedState.get(counterStateKey, {
    sharedState: createStorage({
      filepath,
      initialValue: { value: 0 },
      mergeInitialValue: (_initialValue, savedValue) => savedCounter.parse(savedValue),
    }),
  });
}
