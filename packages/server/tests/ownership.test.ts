import { defineService } from '@devkit/core';
import type { RuntimeDiagnostic } from '@devkit/core';
import { describe, expect, it, vi } from 'vitest';

import { installDevframeProvider, installDevToolsProvider, serverExecution } from '../src/index.js';

import { admitted, counterCapability, counterService, deferred } from './fixtures.js';
import { createDevframeHost, createDevToolsHost, listenHost } from './host-fixtures.js';

describe('native host ownership', () => {
  it('guards concurrent installation across entry points and releases only after disposal', async () => {
    expect.assertions(7);
    const host = await createDevToolsHost();
    const setup = deferred();
    const service = defineService(counterCapability, {
      id: 'example.delayed',
      execution: serverExecution,
      async setup() {
        await setup.promise;
        return { increment: (value) => value };
      },
    });
    const installing = installDevToolsProvider(host.context, {
      providerId: 'example.stable',
      services: [service],
    });
    await expect(
      installDevframeProvider(host.context, { providerId: 'example.other' }),
    ).rejects.toThrow('already owns');
    setup.resolve();
    const provider = await installing;
    const disposal = provider.dispose();
    expect(provider.dispose()).toBe(disposal);
    await disposal;
    const replacement = await installDevframeProvider(host.context, {
      providerId: 'example.stable',
    });
    expect(replacement.provider.id).toBe(provider.provider.id);
    expect(replacement.provider.realm).toEqual(provider.provider.realm);
    expect(replacement.provider.incarnation).not.toBe(provider.provider.incarnation);
    expect(admitted(provider.startup.services[0]).snapshot().status).toBe('disposed');
    expect(replacement.startup.services).toEqual([]);
    await replacement.dispose();
  });

  it('releases a strict rejected startup without running any setup', async () => {
    expect.assertions(4);
    const host = await createDevframeHost();
    const setup = vi.fn<() => { increment(value: number): number }>(() => ({
      increment: (value: number) => value,
    }));
    const service = defineService(counterCapability, {
      id: 'example.duplicate',
      execution: serverExecution,
      setup,
    });
    const report = vi.fn<(diagnostic: RuntimeDiagnostic, cause?: unknown) => void>();
    await expect(
      installDevframeProvider(host.context, {
        providerId: 'example.strict',
        strict: true,
        services: [service, service],
        report,
      }),
    ).rejects.toMatchObject({ code: 'duplicate-registration' });
    expect(setup).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalled();
    const replacement = await installDevframeProvider(host.context, {
      providerId: 'example.strict',
    });
    expect(replacement.provider.id).toBe('example.strict');
    await replacement.dispose();
  });

  it('keeps failed cleanup reserved and preserves its rejected disposal promise', async () => {
    expect.assertions(5);
    const host = await createDevframeHost();
    const cleanupFailure = new Error('native cleanup still blocked');
    const cleanup = vi.fn<() => void>(() => {
      throw cleanupFailure;
    });
    const report = vi.fn<(diagnostic: RuntimeDiagnostic, cause?: unknown) => void>();
    const service = defineService(counterCapability, {
      id: 'example.cleanup',
      execution: serverExecution,
      setup({ scope }) {
        scope.onDispose(cleanup);
        return { increment: (value) => value };
      },
    });
    const provider = await installDevframeProvider(host.context, {
      providerId: 'example.blocked',
      services: [service],
      report,
    });
    const disposal = provider.dispose();
    await expect(disposal).rejects.toMatchObject({ code: 'cleanup-failure' });
    expect(provider.dispose()).toBe(disposal);
    expect(cleanup).toHaveBeenCalledExactlyOnceWith();
    expect(admitted(provider.startup.services[0]).snapshot().status).toBe('cleanup-blocked');
    await expect(
      installDevframeProvider(host.context, { providerId: 'example.replacement' }),
    ).rejects.toThrow('already owns');
  });

  it('rejects an empty configured identity before claiming a native context', async () => {
    expect.assertions(2);
    const host = await createDevframeHost();
    await expect(installDevframeProvider(host.context, { providerId: '  ' })).rejects.toThrow(
      'must not be empty',
    );
    const provider = await installDevframeProvider(host.context, { providerId: 'example.valid' });
    expect(provider.provider.id).toBe('example.valid');
    await provider.dispose();
  });

  it('keeps an externally listening HTTP server alive after adapter disposal', async () => {
    expect.assertions(3);
    const host = await createDevframeHost();
    const origin = await listenHost(host.httpServer);
    const provider = await installDevframeProvider(host.context, {
      providerId: 'example.http',
      services: [counterService],
    });
    await provider.dispose();
    expect(host.httpServer.listening).toBe(true);
    const response = await fetch(`${origin}/unrelated`);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('host-alive');
  });
});
