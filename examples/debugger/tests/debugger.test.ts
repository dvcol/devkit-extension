import {
  nativeBoundary,
  chromiumHost,
  titleReply,
  failedReply,
  deferred,
  delayedReply,
  installationHandle,
} from './native-boundary.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageTitleCapability, readPageTitleAction } from '../src/contracts.js';
import { createDebuggerHost } from '../src/host.js';
import { installDebuggerContributions } from '../src/provider.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CDB contribution ownership', () => {
  it('runs portable actions with released CDB leases without taking ownership of the host', async () => {
    expect.assertions(11);
    const boundary = nativeBoundary();
    const host = chromiumHost();
    const { provider } = await installDebuggerContributions(host.bridge, vi.fn<() => void>());
    try {
      const target = await host.publisher.publish({
        tabId: 7,
        incognito: false,
        url: 'https://example.test/',
      });
      const input = { id: target.id, generation: target.generation };
      await expect(provider.invoke({ action: readPageTitleAction, input })).resolves.toBe(
        'Example title',
      );
      await expect(provider.invoke({ action: readPageTitleAction, input })).resolves.toBe(
        'Example title',
      );
      expect(host.bridge.broker.listLeases()).toEqual([]);
      expect(boundary.attach).toHaveBeenCalledTimes(1);
      await provider.dispose();
      expect(boundary.detach).not.toHaveBeenCalled();
      expect(host.bridge.broker.listTargets()).toHaveLength(1);
      expect(await host.bridge.client.listTargets()).toHaveLength(1);
      const disposal = host.dispose();
      expect(host.dispose()).toBe(disposal);
      await disposal;
      expect(boundary.detach).toHaveBeenCalledTimes(1);
      expect(
        boundary.onEvent.listeners.size +
          boundary.onDetach.listeners.size +
          boundary.onRemoved.listeners.size +
          boundary.onUpdated.listeners.size,
      ).toBe(0);
      expect(() => host.bridge.broker.listTargets()).toThrow('disposed');
    } finally {
      await provider.dispose();
      await host.dispose();
    }
  });

  it('releases the lease after native command failure and permits a later call without replay', async () => {
    expect.assertions(4);
    const boundary = nativeBoundary();
    const host = chromiumHost();
    const { provider } = await installDebuggerContributions(host.bridge, vi.fn<() => void>());
    try {
      const target = await host.publisher.publish({
        tabId: 7,
        incognito: false,
        url: 'https://example.test/',
      });
      const input = { id: target.id, generation: target.generation };
      boundary.sendCommand.mockImplementation(failedReply);
      await expect(provider.invoke({ action: readPageTitleAction, input })).rejects.toBeInstanceOf(
        Error,
      );
      expect(host.bridge.broker.listLeases()).toEqual([]);
      boundary.sendCommand.mockImplementation(titleReply('Example title'));
      await expect(provider.invoke({ action: readPageTitleAction, input })).resolves.toBe(
        'Example title',
      );
      expect(
        boundary.sendCommand.mock.calls.filter(([, method]) => method === 'Runtime.evaluate'),
      ).toHaveLength(2);
    } finally {
      await provider.dispose();
      await host.dispose();
    }
  });

  it('rejects a revoked CDB reference without attaching or replaying native work', async () => {
    expect.assertions(4);
    const boundary = nativeBoundary();
    const host = chromiumHost();
    const { provider } = await installDebuggerContributions(host.bridge, vi.fn<() => void>());
    try {
      const target = await host.publisher.publish({
        tabId: 7,
        incognito: false,
        url: 'https://example.test/',
      });
      await host.publisher.revoke();
      await expect(
        provider.invoke({
          action: readPageTitleAction,
          input: { id: target.id, generation: target.generation },
        }),
      ).rejects.toBeInstanceOf(Error);
      expect(boundary.attach).toHaveBeenCalledTimes(1);
      expect(
        boundary.sendCommand.mock.calls.filter(([, method]) => method === 'Runtime.evaluate'),
      ).toEqual([]);
      expect(host.bridge.broker.listLeases()).toEqual([]);
    } finally {
      await provider.dispose();
      await host.dispose();
    }
  });

  it('rejects malformed command replies and releases their lease', async () => {
    expect.assertions(2);
    const boundary = nativeBoundary();
    const host = chromiumHost();
    const { provider } = await installDebuggerContributions(host.bridge, vi.fn<() => void>());
    try {
      const target = await host.publisher.publish({
        tabId: 7,
        incognito: false,
        url: 'https://example.test/',
      });
      boundary.sendCommand.mockImplementation(titleReply(42));
      await expect(
        provider.invoke({
          action: readPageTitleAction,
          input: { id: target.id, generation: target.generation },
        }),
      ).rejects.toBeInstanceOf(Error);
      expect(host.bridge.broker.listLeases()).toEqual([]);
    } finally {
      await provider.dispose();
      await host.dispose();
    }
  });

  it('cancels a delayed action when its service is disabled without replaying or destroying the host', async () => {
    expect.assertions(8);
    const boundary = nativeBoundary();
    const host = chromiumHost();
    const { provider, startup } = await installDebuggerContributions(
      host.bridge,
      vi.fn<() => void>(),
    );
    const started = deferred<void>();
    const nativeResult = deferred<object>();
    const cancelled = deferred<void>();
    const cancelCommand = host.bridge.broker.cancelCommand;
    vi.spyOn(host.bridge.broker, 'cancelCommand').mockImplementation((operationId) => {
      cancelCommand(operationId);
      cancelled.resolve();
    });
    try {
      const target = await host.publisher.publish({
        tabId: 7,
        incognito: false,
        url: 'https://example.test/',
      });
      boundary.sendCommand.mockImplementation(delayedReply(started, nativeResult));
      const operation = provider.invoke({
        action: readPageTitleAction,
        input: { id: target.id, generation: target.generation },
      });
      const rejected = operation.catch((error: unknown) => error);
      await started.promise;
      const service = installationHandle(startup.services[0]);
      let disabled = false;
      const disabling = service.disable().then(() => {
        disabled = true;
        return disabled;
      });
      await cancelled.promise;
      expect(disabled).toBe(false);
      nativeResult.resolve({ result: { value: 'Late title' } });
      await disabling;
      expect(await rejected).toMatchObject({ code: 'cancelled' });
      expect(host.bridge.broker.listLeases()).toEqual([]);
      expect(boundary.detach).not.toHaveBeenCalled();
      expect(host.bridge.broker.listTargets()).toHaveLength(1);
      expect(
        boundary.sendCommand.mock.calls.filter(([, method]) => method === 'Runtime.evaluate'),
      ).toHaveLength(1);
      expect((await provider.resolve({ capability: pageTitleCapability })).status).toBe(
        'unavailable',
      );
      expect(await host.bridge.client.listTargets()).toHaveLength(1);
    } finally {
      nativeResult.resolve({ result: { value: 'Late title' } });
      await provider.dispose();
      await host.dispose();
    }
  });

  it('delegates tab updates and removal to the native CDB lifecycle and reports invalid event payloads', async () => {
    expect.assertions(4);
    const boundary = nativeBoundary();
    const errors: unknown[] = [];
    const host = chromiumHost((error) => {
      errors.push(error);
    });
    try {
      await host.publisher.publish({ tabId: 7, incognito: false, url: 'https://example.test/' });
      const updated = deferred<void>();
      const refresh = host.publisher.refresh;
      const observedRefresh = vi
        .spyOn(host.publisher, 'refresh')
        .mockImplementation(async (tab) => {
          await refresh(tab);
          updated.resolve();
        });
      for (const listener of boundary.onUpdated.listeners)
        listener(
          7,
          {},
          { id: 7, incognito: false, url: 'https://example.test/new', title: 'Changed' },
        );
      await updated.promise;
      expect(observedRefresh).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ tabId: 7, title: 'Changed', url: 'https://example.test/new' }),
      );
      for (const listener of boundary.onEvent.listeners)
        listener({ tabId: 7 }, 'Runtime.consoleAPICalled', { invalid: undefined });
      expect(errors).toHaveLength(1);
      for (const listener of boundary.onRemoved.listeners) listener(7);
      expect(host.bridge.broker.listTargets()).toEqual([]);
      await host.dispose();
      expect(boundary.onUpdated.listeners.size).toBe(0);
    } finally {
      await host.dispose();
    }
  });

  it('reports Firefox as unavailable without accessing Chromium APIs or installing its service', async () => {
    expect.assertions(5);
    vi.stubGlobal('chrome', null);
    const host = createDebuggerHost('firefox', vi.fn<() => void>());
    expect(host).toEqual({ status: 'unavailable', reason: 'unsupported-browser' });
    const { provider, startup } = await installDebuggerContributions(
      undefined,
      vi.fn<() => void>(),
    );
    try {
      expect(startup.services).toEqual([]);
      expect(startup.plugins[0]?.snapshot().contributions).toEqual([
        expect.objectContaining({ status: 'waiting', reason: 'dependency-unavailable' }),
      ]);
      expect((await provider.resolve({ capability: pageTitleCapability })).status).toBe(
        'unavailable',
      );
      await expect(
        provider.invoke({
          action: readPageTitleAction,
          input: { id: crypto.randomUUID(), generation: 1 },
        }),
      ).rejects.toMatchObject({ code: 'unavailable-capability' });
    } finally {
      await provider.dispose();
    }
  });
});
