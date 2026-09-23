const extensionGlobals = globalThis as typeof globalThis & { browser?: typeof chrome; chrome: typeof chrome };
export const extensionApi = extensionGlobals.browser ?? extensionGlobals.chrome;
export interface ProbeReply { count: number; memoryCount: number; backgroundVersion: string; boot: number; error?: string; }
export function isProbeReply(value: unknown): value is ProbeReply {
  if (typeof value !== 'object' || value === null) return false;
  return 'count' in value && typeof value.count === 'number' && 'memoryCount' in value && typeof value.memoryCount === 'number' && 'backgroundVersion' in value && typeof value.backgroundVersion === 'string' && 'boot' in value && typeof value.boot === 'number';
}
export async function callProbe(action = 'fixture.read'): Promise<ProbeReply> {
  const reply: unknown = await extensionApi.runtime.sendMessage({ action });
  if (!isProbeReply(reply)) throw new Error('Unexpected probe response');
  return reply;
}
