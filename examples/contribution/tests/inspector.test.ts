import {
  configureInspectorAction,
  markInspectorAction,
  readInspectorAction,
  resetInspectorAction,
} from '@devkit/example-contribution/inspector';
import { describe, expect, it } from 'vitest';

import {
  createInspectorProvider,
  initialInspectorState,
  memoryInspector,
  requireOperationFailure,
} from './inspector-fixtures.js';

describe('shared response inspector actions', () => {
  it('keeps two provider states independent and preserves native support separately from requested configuration', async () => {
    expect.assertions(8);
    const firstState = initialInspectorState('https://first.example.test/response', {
      status: 'available',
    });
    const secondState = initialInspectorState('https://second.example.test/response', {
      status: 'unavailable',
      reason: 'Response replacement is not supported by this host',
    });
    const first = await createInspectorProvider('first-inspector', memoryInspector(firstState));
    const second = await createInspectorProvider('second-inspector', memoryInspector(secondState));
    try {
      await expect(
        first.provider.invoke({ action: readInspectorAction, input: {} }),
      ).resolves.toEqual(firstState);
      await expect(
        first.provider.invoke({ action: configureInspectorAction, input: { enabled: true } }),
      ).resolves.toEqual({ ...firstState, configuration: { enabled: true } });
      await expect(
        first.provider.invoke({ action: markInspectorAction, input: {} }),
      ).resolves.toEqual({ ...firstState, configuration: { enabled: true }, marker: true });
      await expect(
        second.provider.invoke({ action: readInspectorAction, input: {} }),
      ).resolves.toEqual(secondState);
      await expect(
        second.provider.invoke({ action: configureInspectorAction, input: { enabled: true } }),
      ).resolves.toEqual({ ...secondState, configuration: { enabled: true } });
      await expect(
        first.provider.invoke({ action: readInspectorAction, input: {} }),
      ).resolves.toEqual({ ...firstState, configuration: { enabled: true }, marker: true });
      await expect(
        first.provider.invoke({ action: resetInspectorAction, input: {} }),
      ).resolves.toEqual(firstState);
      await expect(
        second.provider.invoke({ action: readInspectorAction, input: {} }),
      ).resolves.toEqual({ ...secondState, configuration: { enabled: true } });
    } finally {
      await first.provider.dispose();
      await second.provider.dispose();
    }
  });

  it('forwards a host operation failure without changing either provider or losing the local cause', async () => {
    expect.assertions(5);
    const deniedState = initialInspectorState('https://denied.example.test/response', {
      status: 'unavailable',
      reason: 'Host permission was denied',
    });
    const otherState = initialInspectorState('https://other.example.test/response', {
      status: 'available',
    });
    const nativeFailure = new DOMException('Host permission was denied', 'NotAllowedError');
    const denied = await createInspectorProvider('denied-inspector', {
      ...memoryInspector(deniedState),
      configure() {
        throw nativeFailure;
      },
    });
    const other = await createInspectorProvider('other-inspector', memoryInspector(otherState));
    try {
      const failure = requireOperationFailure(
        await denied.provider
          .invoke({ action: configureInspectorAction, input: { enabled: true } })
          .catch((error: unknown) => error),
      );
      expect(failure.code).toBe('operation-failed');
      expect(failure.cause).toBe(nativeFailure);
      expect(denied.report).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'operation-failed', phase: 'call' }),
        nativeFailure,
      );
      await expect(
        denied.provider.invoke({ action: readInspectorAction, input: {} }),
      ).resolves.toEqual(deniedState);
      await expect(
        other.provider.invoke({ action: readInspectorAction, input: {} }),
      ).resolves.toEqual(otherState);
    } finally {
      await denied.provider.dispose();
      await other.provider.dispose();
    }
  });
});
