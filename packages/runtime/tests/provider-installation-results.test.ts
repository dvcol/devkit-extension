import { describe, expect, it } from 'vitest';

import { admitted, echoService, provider } from './provider-fixtures.js';

describe('installation results follow provider strictness', () => {
  it('returns strict startup and later handles directly, including replacement', async () => {
    expect.assertions(5);
    const { runtime } = provider();
    const startup = await runtime.startup({ services: [echoService()] });
    const original = admitted(startup.services[0]);
    expect(original.snapshot().status).toBe('ready');
    expect('handle' in original).toBe(false);
    const replacement = await runtime.services.replace(original, echoService('successor'));
    expect(original.snapshot().status).toBe('disposed');
    expect(replacement.snapshot().status).toBe('ready');
    await replacement.dispose();
    const installed = await runtime.services.install(echoService('later'));
    expect(installed.snapshot().status).toBe('ready');
    await runtime.dispose();
  });

  it('returns relaxed admission outcomes without inventing a skipped handle', async () => {
    expect.assertions(4);
    const { runtime } = provider({ strict: false });
    const installed = await runtime.services.install(echoService());
    expect(installed.status).toBe('admitted');
    const handle = admitted(installed);
    const skipped = await runtime.services.install(echoService('duplicate'));
    expect(skipped).toMatchObject({ status: 'skipped', diagnostic: { severity: 'warning' } });
    expect('handle' in skipped).toBe(false);
    const replacement = await runtime.services.replace(handle, echoService('successor'));
    expect(replacement.status).toBe('admitted');
    await runtime.dispose();
  });

  it('uses the selected mode when strictness comes from runtime configuration', async () => {
    expect.assertions(2);
    for (const strict of [true, false]) {
      const { runtime } = provider({ strict });
      const installed = await runtime.services.install(echoService());
      expect('snapshot' in installed).toBe(strict);
      await runtime.dispose();
    }
  });
});
