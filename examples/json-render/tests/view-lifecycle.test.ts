import { JSON_RENDER_INDEX_KEY } from '@devframes/json-render';
import type { DevframeJsonRenderSpec, JsonRenderIndex } from '@devframes/json-render';
import { counterStateKey, increaseCounterAction } from '@devkit/example-contribution';
import { createJsonRenderExample } from '@devkit/example-json-render';
import { describe, expect, it } from 'vitest';

describe.each(['devframe', 'devtools'] as const)('%s view contribution', (mode) => {
  it('owns native publication through plugin and capability lifetimes without owning business state', async () => {
    expect.assertions(15);
    const example = await createJsonRenderExample(mode);
    try {
      const { sharedState } = example.host.context.rpc;
      const index = await sharedState.get<JsonRenderIndex>(JSON_RENDER_INDEX_KEY);
      const business = await sharedState.get<{ value: number }>(counterStateKey);
      expect(Object.keys(index.value())).toEqual([example.stateKey]);
      await example.viewPlugin.disable();
      expect(index.value()).toEqual({});
      expect(sharedState.keys()).not.toContain(example.stateKey);
      await expect(
        example.host.provider.invoke({ action: increaseCounterAction, input: { amount: 2 } }),
      ).resolves.toBe(2);
      expect(example.view.value().state).toEqual({ value: 0 });
      await example.viewPlugin.enable();
      const replacement = await sharedState.get<DevframeJsonRenderSpec>(example.stateKey);
      expect(replacement.value().state).toEqual({ value: 2 });
      expect(Object.keys(index.value())).toEqual([example.stateKey]);
      const service = example.host.provider.startup.services[0];
      expect(service).toBeDefined();
      await service!.disable();
      expect(index.value()).toEqual({});
      business.mutate((draft) => {
        draft.value = 3;
      });
      expect(replacement.value().state).toEqual({ value: 2 });
      await service!.enable();
      const restored = await sharedState.get<DevframeJsonRenderSpec>(example.stateKey);
      expect(restored.value().state).toEqual({ value: 3 });
      expect(example.host.context.docks.values()).toContainEqual(example.entry);
      await example.viewPlugin.dispose();
      expect(index.value()).toEqual({});
      expect(sharedState.keys()).not.toContain(example.stateKey);
      expect(business.value()).toEqual({ value: 3 });
    } finally {
      await example.close();
    }
  });
});
