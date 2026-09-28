import { JSON_RENDER_INDEX_KEY } from '@devframes/json-render';
import type { JsonRenderIndex } from '@devframes/json-render';
import { createJsonRenderView as createNodeView } from '@devframes/json-render/node';
import { createJsonRenderView } from '@devframes/json-render/view';
import type { DevframeRpcServerFunctions } from 'devframe/types';
import { RpcFunctionsCollectorBase } from 'devframe/rpc';
import { createRpcSharedStateServerHost } from 'devframe/rpc/shared-state';
import { expect, it } from 'vitest';

it('shares view ownership between the portable and existing node exports', async () => {
  expect.assertions(4);
  const collector = new RpcFunctionsCollectorBase<DevframeRpcServerFunctions, undefined>(undefined);
  const sharedState = createRpcSharedStateServerHost({
    register: (definition) => {
      collector.register(definition);
    },
    broadcast: () => Promise.resolve(),
  });
  const context = { rpc: { sharedState } };
  const spec = {
    root: 'text',
    elements: { text: { type: 'Text', props: { text: 'Native view' } } },
  };
  const first = createJsonRenderView(context, { id: 'first', spec });
  const second = createNodeView(context, { id: 'second', spec });
  try {
    const index = await sharedState.get<JsonRenderIndex>(JSON_RENDER_INDEX_KEY);
    expect(Object.keys(index.value())).toHaveLength(2);
    expect(() => createNodeView(context, { id: 'first', spec })).toThrow('already exists');
    first.dispose();
    expect(Object.keys(index.value())).toHaveLength(1);
    const replacement = createJsonRenderView(context, { id: 'first', spec });
    expect(replacement.ref).toEqual(first.ref);
    replacement.dispose();
  } finally {
    first.dispose();
    second.dispose();
    for (const key of sharedState.keys()) sharedState.delete(key);
  }
});
