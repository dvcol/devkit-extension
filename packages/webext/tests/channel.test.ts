import { createRpcClient } from 'devframe/rpc/client';
import { createRpcServer } from 'devframe/rpc/server';
import { expect, it } from 'vitest';
import { createPortChannel } from '../src/index';
import { createPortPair } from './port-fixture';

it.each(['json', 'clone'] as const)(
  'uses native RPC through %s Port messages',
  async (encoding) => {
    expect.assertions(12);
    const pair = createPortPair(encoding);
    let started = false;
    let release: (() => void) | undefined;
    const completion = new Promise<void>((resolve) => {
      release = resolve;
    });
    let completed = 0;
    const functions = {
      echo: (value: unknown) => value,
      wait: async () => {
        started = true;
        await completion;
        completed += 1;
      },
    };
    const group = createRpcServer<Record<string, never>, typeof functions>(functions);
    const servingChannel = createPortChannel({
      port: pair.second.port,
      onDisconnect: () => {
        for (const connection of group.clients) connection.$close();
      },
    });
    group.updateChannels((channels) => {
      channels.push(servingChannel);
    });
    const connection = createRpcClient<typeof functions>(
      {},
      {
        channel: createPortChannel({
          port: pair.first.port,
          onDisconnect: () => {
            connection.$close();
          },
        }),
      },
    );
    try {
      expect(pair.first.listenerCount()).toBe(2);
      expect(pair.second.listenerCount()).toBe(2);
      const original = new Map([['counter', 42n]]);
      const value = await connection.$call('echo', original);
      expect(value).toEqual(original);
      await expect(connection.$call('echo', { callback: () => {} })).rejects.toThrow('serialize');
      const pending = connection.$call('wait');
      await expect.poll(() => started).toBe(true);
      pair.disconnect();
      await expect(pending).rejects.toThrow('closed');
      expect(pair.first.listenerCount()).toBe(0);
      expect(pair.second.listenerCount()).toBe(0);
      expect(completed).toBe(0);
      release?.();
      await expect.poll(() => completed).toBe(1);
      await expect(connection.$call('echo', 'after close')).rejects.toThrow('closed');
      expect(completed).toBe(1);
    } finally {
      release?.();
      connection.$close();
      for (const servingConnection of group.clients) servingConnection.$close();
      group.updateChannels((channels) => {
        channels.splice(0);
      });
      pair.disconnect();
    }
  },
);
