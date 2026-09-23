import { styleText } from 'node:util';

import { counterCapability, increaseCounterAction } from '@devkit/example-contribution';
import {
  counterActionsPlugin,
  counterNativeAccess,
  counterService,
  exampleExecution,
  exampleProvider,
  MemoryCounter,
} from '@devkit/example-contribution/provider';
import { createProviderLifecycle } from '@devkit/runtime';

const source = new MemoryCounter();
const provider = createProviderLifecycle({
  provider: { ...exampleProvider, incarnation: crypto.randomUUID() },
  execution: exampleExecution,
  native: counterNativeAccess(source),
  report(diagnostic) {
    console.info(styleText('yellow', '🚀 [contribution]'), diagnostic.message, diagnostic);
  },
});

try {
  await provider.startup({ services: [counterService], plugins: [counterActionsPlugin] });
  const result = await provider.invoke(increaseCounterAction, { amount: 3 });
  const resolution = await provider.resolve(counterCapability);
  if (resolution.status !== 'available') throw new Error('Counter capability did not activate');
  console.info(styleText('cyan', '🚀 [contribution]'), 'Action returned:', result);
  console.info(
    styleText('cyan', '🚀 [contribution]'),
    'Capability reads:',
    await resolution.binding.api.read({}),
  );
  console.info(
    styleText('cyan', '🚀 [contribution]'),
    'Owned subscriptions:',
    source.subscriptionCount,
  );
} finally {
  await provider.dispose();
}

console.info(
  styleText('green', '🚀 [contribution]'),
  'Subscriptions after disposal:',
  source.subscriptionCount,
);
