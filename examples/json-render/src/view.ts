import { defineView } from '@devkit/core';
import type { ExecutionDescriptor, NativeContextDescriptor, ViewDefinition } from '@devkit/core';
import type { JsonRenderViewContext } from '@devframes/json-render/view';
import { counterCapability } from '@devkit/example-contribution';
import { publishCounterView } from './publish.js';
import type { CounterViewOptions } from './publish.js';

/** The same recipe runs in native server and extension providers. */
export function createCounterView(
  options: Omit<CounterViewOptions, 'context'> & {
    readonly execution: ExecutionDescriptor;
    readonly nativeContext: NativeContextDescriptor<JsonRenderViewContext>;
  },
): ViewDefinition<{ counter: typeof counterCapability }> {
  return defineView({
    id: 'example.counter-view',
    execution: options.execution,
    requires: { counter: counterCapability },
    async setup({ native, scope }) {
      const context = native.get(options.nativeContext);
      if (context === undefined) throw new Error('The native JSON view context is required');
      const publication = await publishCounterView({ ...options, context });
      scope.onDispose(publication.dispose);
    },
  });
}
