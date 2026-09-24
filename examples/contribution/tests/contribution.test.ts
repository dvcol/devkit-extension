import type {
  InstallationHandle,
  InstallationResult,
  NativeContextAccess,
  RuntimeDiagnostic,
} from '@devkit/core';
import { createProviderLifecycle } from '@devkit/runtime';
import { describe, expect, it, vi } from 'vitest';

import { counterCapability, increaseCounterAction } from '../src/index.js';
import {
  counterActionsPlugin,
  counterNativeAccess,
  counterService,
  exampleExecution,
  exampleProvider,
  MemoryCounter,
} from '../src/provider.js';

function installationHandle(result: InstallationResult | undefined): InstallationHandle {
  if (result?.status !== 'admitted') throw new Error('Expected an admitted example installation');
  return result.handle;
}

function createLocalProvider(native: NativeContextAccess) {
  const diagnostics: RuntimeDiagnostic[] = [];
  const provider = createProviderLifecycle({
    provider: { ...exampleProvider, incarnation: crypto.randomUUID() },
    execution: exampleExecution,
    native,
    report(diagnostic) {
      diagnostics.push(diagnostic);
    },
  });
  return { provider, diagnostics };
}

describe('UI-free contribution example', () => {
  it('executes its action and capability through a real provider, then removes its subscription', async () => {
    expect.assertions(9);
    const source = new MemoryCounter();
    const { provider, diagnostics } = createLocalProvider(counterNativeAccess(source));
    try {
      const installed = await provider.startup({
        services: [counterService],
        plugins: [counterActionsPlugin],
      });
      const service = installationHandle(installed.services[0]);
      const plugin = installationHandle(installed.plugins[0]);
      expect(service.snapshot().status).toBe('ready');
      expect(plugin.snapshot().status).toBe('ready');
      expect(source.subscriptionCount).toBe(1);
      await expect(
        provider.invoke({ action: increaseCounterAction, input: { amount: 3 } }),
      ).resolves.toBe(3);
      const resolution = await provider.resolve({ capability: counterCapability });
      expect(resolution.status).toBe('available');
      source.increase(2);
      const binding = await availableCounter(provider);
      await expect(binding.api.read({})).resolves.toBe(5);
      expect(diagnostics).toEqual([]);
      await provider.dispose();
      expect(source.subscriptionCount).toBe(0);
      expect(service.snapshot().status).toBe('disposed');
    } finally {
      await provider.dispose();
    }
  });

  it('waits for an omitted service and activates the same plugin after the service is installed', async () => {
    expect.assertions(7);
    const source = new MemoryCounter();
    const { provider } = createLocalProvider(counterNativeAccess(source));
    try {
      const installed = await provider.startup({ plugins: [counterActionsPlugin] });
      const plugin = installationHandle(installed.plugins[0]);
      expect(plugin.snapshot().contributions).toEqual([
        expect.objectContaining({
          id: 'example.increase-counter',
          status: 'waiting',
          reason: 'dependency-unavailable',
        }),
      ]);
      expect(source.subscriptionCount).toBe(0);
      await expect(
        provider.invoke({ action: increaseCounterAction, input: { amount: 1 } }),
      ).rejects.toMatchObject({
        code: 'unavailable-capability',
      });

      const service = installationHandle(await provider.services.install(counterService));
      expect(service.snapshot().status).toBe('ready');
      expect(plugin.snapshot().status).toBe('ready');
      await expect(
        provider.invoke({ action: increaseCounterAction, input: { amount: 2 } }),
      ).resolves.toBe(2);
      expect(source.subscriptionCount).toBe(1);
    } finally {
      await provider.dispose();
    }
  });

  it('keeps setup failure visible in current status and allows a clean disable', async () => {
    expect.assertions(5);
    const { provider, diagnostics } = createLocalProvider({
      get: vi.fn<() => undefined>(),
    });
    try {
      const service = installationHandle(await provider.services.install(counterService));
      expect(service.snapshot().contributions).toEqual([
        expect.objectContaining({ id: 'example.counter-service', status: 'failed' }),
      ]);
      expect(service.snapshot().diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'setup-failure', phase: 'setup' }),
        ]),
      );
      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'setup-failure',
            contributionId: 'example.counter-service',
          }),
        ]),
      );
      expect((await provider.resolve({ capability: counterCapability })).status).toBe(
        'unavailable',
      );
      const disabled = await service.disable();
      expect(disabled.contributions).toEqual([
        expect.objectContaining({ id: 'example.counter-service', status: 'disabled' }),
      ]);
    } finally {
      await provider.dispose();
    }
  });

  it('cleans the active service on disable and prevents an old binding from invoking it', async () => {
    expect.assertions(7);
    const source = new MemoryCounter();
    const { provider } = createLocalProvider(counterNativeAccess(source));
    try {
      const installed = await provider.startup({
        services: [counterService],
        plugins: [counterActionsPlugin],
      });
      const service = installationHandle(installed.services[0]);
      const plugin = installationHandle(installed.plugins[0]);
      const binding = await availableCounter(provider);
      expect(source.subscriptionCount).toBe(1);

      const disabled = await service.disable();
      expect(disabled.status).toBe('inactive');
      expect(source.subscriptionCount).toBe(0);
      expect(plugin.snapshot().contributions).toEqual([
        expect.objectContaining({ status: 'waiting', reason: 'dependency-unavailable' }),
      ]);
      await expect(binding.api.increase({ amount: 4 })).rejects.toBeInstanceOf(Error);
      expect(source.read()).toBe(0);
      expect((await provider.resolve({ capability: counterCapability })).status).toBe(
        'unavailable',
      );
    } finally {
      await provider.dispose();
    }
  });

  it('rejects invalid action input before mutating the native counter', async () => {
    expect.assertions(2);
    const source = new MemoryCounter();
    const { provider } = createLocalProvider(counterNativeAccess(source));
    try {
      await provider.startup({ services: [counterService], plugins: [counterActionsPlugin] });
      await expect(
        provider.invoke({ action: increaseCounterAction, input: { amount: -1 } }),
      ).rejects.toMatchObject({
        code: 'invalid-input',
      });
      expect(source.read()).toBe(0);
    } finally {
      await provider.dispose();
    }
  });
});

async function availableCounter(provider: ReturnType<typeof createProviderLifecycle>) {
  const resolution = await provider.resolve({ capability: counterCapability });
  if (resolution.status !== 'available') throw new Error('Expected the example counter capability');
  return resolution.binding;
}
