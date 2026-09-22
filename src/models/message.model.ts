import type { VersionUpdateDetails } from '@dvcol/web-extension-utils/chrome/models';

export const MessageType = {
  VersionUpdate: 'version-update',
} as const;

export type MessageTypes = (typeof MessageType)[keyof typeof MessageType];

/**
 * Type union of possible message payloads
 */
export type MessagePayload<T extends MessageTypes = MessageTypes> = T extends typeof MessageType.VersionUpdate
  ? VersionUpdateDetails & { date: number }
  : MessageTypes;
