import { increaseCounterAction } from '@devkit/example-contribution';
import { providerFromVite, readProductionStatus } from '@devkit/example-vite-hosts';
import { describe, expect, it, vi } from 'vitest';

import { productionFixture, readPage, settledBuild } from './production-fixture.js';
import { bindingFor } from './fixtures.js';

describe.each(['devframe', 'devtools'] as const)('%s watched production', (host) => {
  it('retains complete assets through early and late failures while its native backend stays live', async () => {
    expect.assertions(27);
    const current = await productionFixture(host);
    const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await fetch(current.origin)).status).toBe(503);
      expect(await (await fetch(`${current.origin}/__build-status`)).json()).toMatchObject({
        phase: 'starting',
        generation: null,
      });
      const provider = await providerFromVite(current.server);
      const incarnation = provider.provider.incarnation;
      await expect(
        provider.invoke({ action: increaseCounterAction, input: { amount: 2 } }),
      ).resolves.toBe(2);
      const exitListeners = process.listenerCount('exit');
      const watcher = await current.watch();
      expect(process.listenerCount('exit')).toBe(exitListeners + 1);
      const initial = await settledBuild(current.output, 'ready');
      const first = await readPage(current.origin);
      expect(first.javascript).toContain('Initial build');
      expect(initial.generation).toMatch(/^generation-/u);
      await expect(current.start()).rejects.toMatchObject({ code: 'EEXIST' });

      await current.change('export const = ;');
      const syntaxFailure = await settledBuild(current.output, 'failed', initial.attempt);
      const syntaxPage = await readPage(current.origin);
      expect(syntaxPage.html).toBe(first.html);
      expect(syntaxPage.javascript).toBe(first.javascript);
      expect(await (await fetch(`${current.origin}/__build-status`)).json()).toMatchObject({
        phase: 'failed',
        generation: initial.generation,
      });
      await expect(
        provider.invoke({ action: increaseCounterAction, input: { amount: 3 } }),
      ).resolves.toBe(5);

      await current.change("document.querySelector('main').textContent = 'Recovered build';");
      const recovered = await settledBuild(current.output, 'ready', syntaxFailure.attempt);
      const second = await readPage(current.origin);
      expect(recovered.generation).not.toBe(initial.generation);
      expect(second.javascript).toContain('Recovered build');

      await current.change("document.querySelector('main').textContent = 'LATE_FAILURE';");
      const lateFailure = await settledBuild(current.output, 'failed', recovered.attempt);
      expect(lateFailure.error).toContain('Deliberate late build failure');
      expect((await readPage(current.origin)).html).toBe(second.html);
      expect(lateFailure.generation).toBe(recovered.generation);

      await current.change("document.querySelector('main').textContent = 'WRITE_FAILURE';");
      const writeFailure = await settledBuild(current.output, 'failed', lateFailure.attempt);
      expect(writeFailure.error).toContain('Deliberate writeBundle failure');
      expect((await readPage(current.origin)).javascript).toBe(second.javascript);
      expect(writeFailure.generation).toBe(recovered.generation);

      await current.change("document.querySelector('main').textContent = 'Final build';");
      await settledBuild(current.output, 'ready', writeFailure.attempt);
      expect((await readPage(current.origin)).javascript).toContain('Final build');
      expect(await (await fetch(first.assetUrl)).text()).toBe(first.javascript);
      expect((await providerFromVite(current.server)).provider.incarnation).toBe(incarnation);
      await expect((await bindingFor(provider)).api.read({})).resolves.toBe(5);
      const closing = watcher.close();
      expect(watcher.close()).toBe(closing);
      await closing;
      expect(process.listenerCount('exit')).toBe(exitListeners);
      expect(readProductionStatus(current.output).phase).toBe('stopped');
      await current.server.close();
      expect(current.server.httpServer.listening).toBe(false);
    } finally {
      diagnostics.mockRestore();
      await current.close();
    }
  });

  it('reuses the last complete generation when a restarted watcher first encounters an error', async () => {
    expect.assertions(5);
    const current = await productionFixture(host);
    const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const watcher = await current.watch();
      const initial = await settledBuild(current.output, 'ready');
      const first = await readPage(current.origin);
      await watcher.close();
      expect(readProductionStatus(current.output).phase).toBe('stopped');
      await current.change('export const = ;');
      await current.watch();
      const failed = await settledBuild(current.output, 'failed', initial.attempt);
      expect(failed.generation).toBe(initial.generation);
      expect((await readPage(current.origin)).javascript).toBe(first.javascript);
      await current.change("document.querySelector('main').textContent = 'Restart recovered';");
      const recovered = await settledBuild(current.output, 'ready', failed.attempt);
      expect(recovered.generation).not.toBe(initial.generation);
      expect((await readPage(current.origin)).javascript).toContain('Restart recovered');
    } finally {
      diagnostics.mockRestore();
      await current.close();
    }
  });
});
