import { extensionApi } from './api';
import { version } from './background-version';
const boot = Date.now();
let memoryCount = 0;
export function startBackground(): void {
  extensionApi.runtime.onMessage.addListener(async (message: unknown) => {
    if (typeof message !== 'object' || message === null || !('action' in message)) return undefined;
    const saved: Record<string, unknown> = await extensionApi.storage.local.get('count');
    let count = typeof saved.count === 'number' ? saved.count : 0;
    if (message.action === 'fixture.increment') {
      count += 1;
      memoryCount += 1;
      await extensionApi.storage.local.set({ count });
    }
    if (message.action === 'fixture.open') await extensionApi.tabs.create({ url: extensionApi.runtime.getURL('popup.html') });
    const error = message.action === 'fixture.fail' ? 'intentional failure' : undefined;
    return { count, memoryCount, backgroundVersion: version, boot, error };
  });
}
