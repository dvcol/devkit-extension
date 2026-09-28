import { readFile } from 'node:fs/promises';
import { DOCK_RENDERERS_STATE_KEY } from '@devframes/hub/constants';
import type { DockRendererManifest } from '@devframes/hub/client';
import type { DevframeJsonRenderSpec } from '@devframes/json-render';
import { jsonRenderUiRenderer } from '@devframes/json-render-ui/hub';
import { createJsonRenderExample } from '@devkit/example-json-render';
import { counterStateKey } from '@devkit/example-server-contexts';
import { connectDevframe } from 'devframe/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { counterActionName } from '../src/spec.js';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).toReversed()) await dispose();
  vi.unstubAllGlobals();
});

async function connect(
  example: Awaited<ReturnType<typeof createJsonRenderExample>>,
  token: string,
) {
  vi.stubGlobal('location', new URL(example.host.origin));
  const nativeClient = await connectDevframe({
    baseURL: `${example.host.origin}/__devkit-remote/`,
    connection: { isolated: true },
    authToken: token,
    simpleAuth: false,
    otpParam: false,
    webmcp: false,
    callTimeout: 3000,
  });
  cleanup.push(() => nativeClient.close?.());
  return nativeClient;
}

describe.each(['devframe', 'devtools'] as const)('%s native JSON view', (mode) => {
  it('publishes the real renderer and synchronizes validated counter actions through native state', async () => {
    expect.assertions(11);
    const example = await createJsonRenderExample(mode);
    cleanup.push(example.close);
    const client = await connect(example, example.host.token);
    const observer = await connect(example, example.host.token);
    await client.ensureTrusted();
    await observer.ensureTrusted();
    const manifest = await client.sharedState.get<DockRendererManifest>(DOCK_RENDERERS_STATE_KEY);
    expect(manifest.value()['json-render']).toEqual({
      importFrom: '/__devkit-remote/__renderers/json-render.mjs',
    });
    const asset = await fetch(`${example.host.origin}/__devkit-remote/__renderers/json-render.mjs`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect(await asset.text()).toBe(await readFile(jsonRenderUiRenderer().file, 'utf8'));
    expect(example.host.context.docks.values()).toContainEqual(example.entry);
    const viewState = await observer.sharedState.get<DevframeJsonRenderSpec>(
      example.view.ref.stateKey,
    );
    expect(viewState.value().state).toEqual({ value: 0 });
    await expect(client.call(counterActionName, { amount: 2 })).resolves.toBe(2);
    await expect.poll(() => viewState.value().state).toEqual({ value: 2 });
    // @ts-expect-error Deliberately malformed input verifies the native wire validation boundary.
    const invalid = client.call(counterActionName, { amount: 'invalid' });
    await expect(invalid).rejects.toThrow(/valid/iu);
    expect(example.view.value().state).toEqual({ value: 2 });
    const denied = await connect(example, 'invalid-example-token');
    await expect(denied.call(counterActionName, { amount: 99 })).rejects.toThrow(
      /not authorized/iu,
    );
  });

  it('releases the projection listener and view when its host closes', async () => {
    expect.assertions(4);
    const example = await createJsonRenderExample(mode);
    cleanup.push(example.close);
    const state = await example.host.context.rpc.sharedState.get<{ value: number }>(
      counterStateKey,
    );
    state.mutate((value) => {
      value.value = 3;
    });
    expect(example.view.value().state).toEqual({ value: 3 });
    await example.close();
    expect(example.host.context.rpc.sharedState.keys()).not.toContain(example.view.ref.stateKey);
    expect(() => {
      state.mutate((value) => {
        value.value = 4;
      });
    }).not.toThrow();
    expect(example.view.value().state).toEqual({ value: 3 });
  });
});
