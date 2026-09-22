import { onVersionUpdate } from '@dvcol/web-extension-utils/chrome/runtime';

import { MessageType } from '~/models/message.model';
import { Logger } from '~/services/logger.service';
import { storage } from '~/utils/browser/browser-storage.utils';

Logger.debug('Background script started');

try {
  onVersionUpdate(async (details) => {
    Logger.debug('Extension updated', details);
    await storage.local.set(MessageType.VersionUpdate, { ...details, date: Date.now() });
  });
} catch (error) {
  Logger.error('Failed to handle version update', error);
}
