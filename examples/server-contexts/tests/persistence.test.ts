import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemoteHost } from '@devkit/example-server-contexts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectState } from './state-fixtures.js';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).toReversed()) await dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function storageDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'devkit-persistent-counter-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function host(mode: 'devframe' | 'devtools', counterStoragePath: string) {
  const server = await createRemoteHost(mode, { counterStoragePath });
  cleanup.push(server.close);
  return server;
}

async function stored(filepath: string): Promise<unknown> {
  const snapshot: unknown = JSON.parse(await readFile(filepath, 'utf8'));
  return snapshot;
}

describe.each(['devframe', 'devtools'] as const)('%s native persistent counter', (mode) => {
  it('shares native state and restores observed disk writes after a fresh host starts', async () => {
    expect.assertions(17);
    const directory = await storageDirectory();
    const filepath = join(directory, 'counter.json');
    const unrelatedPath = join(directory, 'unrelated.txt');
    await writeFile(unrelatedPath, 'Owned by the caller');
    const original = await host(mode, filepath);
    const writer = await connectState(original, cleanup);
    const peer = await connectState(original, cleanup);
    expect([writer.state.value(), peer.state.value()]).toEqual([{ value: 0 }, { value: 0 }]);
    await expect(writer.increase(3)).resolves.toBe(3);
    await expect.poll(() => peer.state.value()).toEqual({ value: 3 });
    await expect.poll(() => stored(filepath)).toEqual({ value: 3 });
    peer.state.mutate((state) => {
      state.value = 7;
    });
    await expect.poll(() => writer.state.value()).toEqual({ value: 7 });
    await expect.poll(() => stored(filepath)).toEqual({ value: 7 });
    writer.close();
    peer.close();
    await original.close();
    expect(await stored(filepath)).toEqual({ value: 7 });
    expect(await readFile(unrelatedPath, 'utf8')).toBe('Owned by the caller');

    const replacement = await host(mode, filepath);
    const restored = await connectState(replacement, cleanup);
    expect(replacement.provider.provider.incarnation).not.toBe(
      original.provider.provider.incarnation,
    );
    expect(restored.state.value()).toEqual({ value: 7 });
    await expect(restored.increase(1)).resolves.toBe(8);
    await expect.poll(() => stored(filepath)).toEqual({ value: 8 });

    const independentPath = join(directory, 'independent.json');
    const independent = await connectState(await host(mode, independentPath), cleanup);
    expect(independent.state.value()).toEqual({ value: 0 });
    await expect(independent.increase(2)).resolves.toBe(2);
    await expect.poll(() => stored(independentPath)).toEqual({ value: 2 });
    expect(restored.state.value()).toEqual({ value: 8 });
    expect(await stored(filepath)).toEqual({ value: 8 });
  });

  it.each(['not JSON', '{"value":"invalid"}'])(
    'retains the native warning and initial value for invalid saved data %s',
    async (saved) => {
      expect.assertions(6);
      const directory = await storageDirectory();
      const filepath = join(directory, 'counter.json');
      await writeFile(filepath, saved);
      const warning = vi.spyOn(console, 'warn');
      const server = await host(mode, filepath);
      const client = await connectState(server, cleanup);
      expect(client.state.value()).toEqual({ value: 0 });
      expect(warning.mock.calls.flat().map(String).join('\n')).toContain('DF0012');
      expect(warning.mock.calls.flat().map(String).join('\n')).toContain(filepath);
      expect(await readFile(filepath, 'utf8')).toBe(saved);
      await expect(client.increase(1)).resolves.toBe(1);
      await expect.poll(() => stored(filepath)).toEqual({ value: 1 });
    },
  );

  it('reports a real write failure without claiming that action completion persisted it', async () => {
    expect.assertions(7);
    const directory = await storageDirectory();
    const obstruction = join(directory, 'not-a-directory');
    const filepath = join(obstruction, 'counter.json');
    await writeFile(obstruction, 'Caller-owned file');
    const diagnostic = vi.spyOn(console, 'error');
    const server = await host(mode, filepath);
    const writer = await connectState(server, cleanup);
    const peer = await connectState(server, cleanup);
    await expect(writer.increase(3)).resolves.toBe(3);
    await expect.poll(() => peer.state.value()).toEqual({ value: 3 });
    await expect
      .poll(() => diagnostic.mock.calls.flat().map(String).join('\n'))
      .toContain('DF0035');
    expect(diagnostic.mock.calls.flat().map(String).join('\n')).toContain(filepath);
    expect(await readFile(obstruction, 'utf8')).toBe('Caller-owned file');
    await expect(readFile(filepath, 'utf8')).rejects.toMatchObject({ code: 'ENOTDIR' });
    writer.close();
    peer.close();
    await server.close();
    const fresh = await connectState(await host(mode, filepath), cleanup);
    expect(fresh.state.value()).toEqual({ value: 0 });
  });
});
