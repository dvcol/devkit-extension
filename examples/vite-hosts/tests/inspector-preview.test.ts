import {
  configureInspectorAction,
  inspectorCapability,
  markInspectorAction,
  readInspectorAction,
  resetInspectorAction,
} from '@devkit/example-contribution/inspector';
import { describe, expect, it, vi } from 'vitest';

import { inspectorPreviewFixture, previewText } from './inspector-preview-fixture.js';

const disposalCases = [
  {
    resource: 'script',
    body: 'native:fixture:original',
    availability: 'available',
    action: 'active',
  },
  { resource: 'transform', body: 'fixture:original', availability: 'available', action: 'active' },
  { resource: 'service', body: 'fixture:original', availability: 'unavailable', action: 'waiting' },
] as const;

describe.each(['devframe', 'devtools'] as const)(
  '%s response inspector in native preview',
  (host) => {
    it('changes owned response bytes and rejects live markers before changing state or built HTML', async () => {
      expect.assertions(11);
      await using cleanup = new AsyncDisposableStack();
      const current = await inspectorPreviewFixture(host);
      cleanup.defer(current.close);
      const { provider, origin, state, builtHtml } = current;
      const target = `${origin}/inspector-response`;
      expect(await previewText(origin, '/')).toBe(builtHtml);
      await expect(
        provider.invoke({ action: readInspectorAction, input: {} }),
      ).resolves.toMatchObject({
        target,
        latest: { url: target, status: 200, body: 'fixture:original' },
        marker: false,
      });
      await expect(
        provider.invoke({ action: configureInspectorAction, input: { enabled: true } }),
      ).resolves.toMatchObject({ configuration: { enabled: true } });
      expect(await previewText(origin, '/inspector-response')).toBe('native:fixture:original');
      await expect(
        provider.invoke({ action: readInspectorAction, input: {} }),
      ).resolves.toMatchObject({
        latest: { url: target, status: 200, body: 'native:fixture:original' },
      });
      const beforeMarker = structuredClone(state.value());
      const reporting = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await expect(
          provider.invoke({ action: markInspectorAction, input: {} }),
        ).rejects.toMatchObject({
          code: 'operation-failed',
          cause: new Error(
            'Vite preview serves built HTML; page markers must be included during build',
          ),
        });
      } finally {
        reporting.mockRestore();
      }
      expect(state.value()).toEqual(beforeMarker);
      expect(await previewText(origin, '/')).toBe(builtHtml);
      await expect(provider.invoke({ action: resetInspectorAction, input: {} })).resolves.toEqual({
        target: null,
        configuration: { enabled: false },
        modification: { status: 'available' },
        latest: null,
        marker: false,
      });
      expect(await previewText(origin, '/inspector-response')).toBe('fixture:original');
      expect(await previewText(origin, '/')).toBe(builtHtml);
    });

    it.each(disposalCases)(
      'disposes $resource independently while retaining built HTML',
      async (expected) => {
        expect.assertions(8);
        await using cleanup = new AsyncDisposableStack();
        const current = await inspectorPreviewFixture(host);
        cleanup.defer(current.close);
        const { provider, handles, origin, builtHtml } = current;
        await provider.invoke({ action: configureInspectorAction, input: { enabled: true } });
        expect(await previewText(origin, '/inspector-response')).toBe('native:fixture:original');
        await handles[expected.resource].dispose();
        expect(handles[expected.resource].snapshot().status).toBe('disposed');
        expect(await previewText(origin, '/inspector-response')).toBe(expected.body);
        expect(await previewText(origin, '/')).toBe(builtHtml);
        expect((await provider.resolve({ capability: inspectorCapability })).status).toBe(
          expected.availability,
        );
        expect(
          handles.actions.snapshot().contributions.map((contribution) => contribution.status),
        ).toEqual([expected.action, expected.action, expected.action, expected.action]);
        await provider.dispose();
        expect(await previewText(origin, '/inspector-response')).toBe('fixture:original');
        expect(await previewText(origin, '/')).toBe(builtHtml);
      },
    );
  },
);
