import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectDevframe, setupDevframeConnection } from 'devframe/client';
import type { DevframeConnection, DevframeRpcClientOptions } from 'devframe/client';

const storedConnection: DevframeConnection = {
  connectionMeta: { backend: 'static' },
  metaBaseUrl: 'http://stored.example/__connection.json',
  authToken: 'stored-token',
};
const explicitConnection: DevframeConnection = {
  connectionMeta: { backend: 'static' },
  metaBaseUrl: 'http://explicit.example/__connection.json',
  isolated: true,
};
const clientOptions = {
  connection: explicitConnection,
  otpParam: false,
  simpleAuth: false,
  webmcp: false,
} satisfies DevframeRpcClientOptions;
const getItem = vi.fn<Storage['getItem']>();
const setItem = vi.fn<Storage['setItem']>();
const fetchMetadata = vi.fn<typeof fetch>();
const closeChannel = vi.fn<() => void>();
const broadcastChannel = vi.fn<() => { close: () => void }>(function createAuthChannel() {
  return { close: closeChannel };
});

function readGlobal(name: string): unknown {
  return Reflect.get(globalThis, name);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('parent', { window: globalThis });
  vi.stubGlobal('location', new URL('http://viewer.example/index.html'));
  vi.stubGlobal('localStorage', { getItem, setItem });
  vi.stubGlobal('fetch', fetchMetadata);
  vi.stubGlobal('BroadcastChannel', broadcastChannel);
  vi.stubGlobal('__DEVFRAME_CONNECTION__', storedConnection);
  vi.stubGlobal('__DEVFRAME_CONNECTION_META__', storedConnection.connectionMeta);
  vi.stubGlobal('__DEVFRAME_CONNECTION_AUTH_TOKEN__', 'stored-token');
  getItem.mockReturnValue('stored-token');
  fetchMetadata.mockImplementation((input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.endsWith('state.json')) return Promise.resolve(Response.json({ output: {} }));
    return Promise.resolve(
      Response.json({
        'devframe:rpc:server-state:get': { type: 'query', records: {}, fallback: 'state.json' },
      }),
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('packaged Devframe connection isolation', () => {
  it('does not discover or persist shared credentials for an explicit isolated connection', async () => {
    expect.assertions(5);
    const connection = await setupDevframeConnection({
      connection: explicitConnection,
    });
    expect(connection).toBe(explicitConnection);
    expect(connection.authToken).toBeUndefined();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(readGlobal('__DEVFRAME_CONNECTION__')).toBe(storedConnection);
  });

  it('fetches the requested base and retains isolation when reusing its descriptor', async () => {
    expect.assertions(8);
    fetchMetadata.mockResolvedValue(
      Response.json({ backend: 'static', authToken: 'metadata-token' }),
    );
    const connection = await setupDevframeConnection({
      baseURL: 'http://requested.example/provider/',
      connection: { isolated: true },
    });
    expect(fetchMetadata).toHaveBeenCalledExactlyOnceWith(
      'http://requested.example/provider/__connection.json',
    );
    expect(connection.metaBaseUrl).toBe('http://requested.example/provider/__connection.json');
    expect(connection.authToken).toBe('metadata-token');
    expect(connection.isolated).toBe(true);
    expect(await setupDevframeConnection({ connection })).toBe(connection);
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(readGlobal('__DEVFRAME_CONNECTION__')).toBe(storedConnection);
  });

  it('accepts explicit metadata and token without reading or writing shared caches', async () => {
    expect.assertions(6);
    const connection = await setupDevframeConnection({
      connectionMeta: { backend: 'static', authToken: 'metadata-token' },
      baseURL: 'http://requested.example/',
      authToken: 'explicit-token',
      connection: { isolated: true },
    });
    expect(connection.authToken).toBe('explicit-token');
    expect(connection.metaBaseUrl).toBe('http://requested.example/__connection.json');
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(fetchMetadata).not.toHaveBeenCalled();
    expect(readGlobal('__DEVFRAME_CONNECTION_META__')).toBe(storedConnection.connectionMeta);
  });

  it.each([{}, { connection: {} }, { connection: { isolated: false } }])(
    'retains default cache discovery with %j',
    async (options) => {
      expect.assertions(5);
      const connection = await setupDevframeConnection({
        baseURL: 'http://ignored.example/',
        ...options,
      });
      expect(connection).toBe(storedConnection);
      expect(getItem).toHaveBeenCalled();
      expect(fetchMetadata).not.toHaveBeenCalled();
      expect(setItem).toHaveBeenCalledExactlyOnceWith(
        '__DEVFRAME_CONNECTION_AUTH_TOKEN__',
        'stored-token',
      );
      expect(readGlobal('__DEVFRAME_CONNECTION__')).toEqual(storedConnection);
    },
  );

  it('keeps explicit token updates local and creates no authentication broadcast channel', async () => {
    expect.assertions(10);
    const client = await connectDevframe(clientOptions);
    try {
      expect(await client.requestTrustWithToken('local-new-token')).toBe(true);
      expect(client.connection.authToken).toBe('local-new-token');
      expect(getItem).not.toHaveBeenCalled();
      expect(setItem).not.toHaveBeenCalled();
      expect(broadcastChannel).not.toHaveBeenCalled();
      expect(readGlobal('__DEVFRAME_CONNECTION_AUTH_TOKEN__')).toBe('stored-token');
      expect(client.sharedState).toBeDefined();
      expect(client.services).toBeDefined();
      const recreated = await connectDevframe({ ...clientOptions, connection: client.connection });
      try {
        expect(recreated.connection.isolated).toBe(true);
        expect(broadcastChannel).not.toHaveBeenCalled();
      } finally {
        recreated.close?.();
      }
    } finally {
      client.close?.();
    }
  });

  it.each([{}, { isolated: false }])(
    'retains default token persistence and authentication channel cleanup with %j',
    async (options) => {
      expect.assertions(5);
      const client = await connectDevframe({
        ...clientOptions,
        connection: { ...storedConnection, ...options },
      });
      try {
        expect(await client.requestTrustWithToken('shared-new-token')).toBe(true);
        expect(client.connection.authToken).toBe('shared-new-token');
        expect(setItem).toHaveBeenLastCalledWith(
          '__DEVFRAME_CONNECTION_AUTH_TOKEN__',
          'shared-new-token',
        );
        expect(broadcastChannel).toHaveBeenCalledExactlyOnceWith('devframe-auth');
      } finally {
        client.close?.();
      }
      expect(closeChannel).toHaveBeenCalledOnce();
    },
  );
});
