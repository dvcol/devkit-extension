import type { ChromeDebuggerPort } from '@dvcol/cdb-extension';
import type { JsonObject } from '@dvcol/cdb';
import { z } from 'zod';

export const nativeMessage: z.ZodType<JsonObject> = z.record(z.string(), z.json());

/** Native replies cross CDB's JSON boundary without exposing Chrome tab IDs to contributions. */
export const nativeDebugger: ChromeDebuggerPort = {
  attach: (target, version) => chrome.debugger.attach(target, version),
  detach: (target) => chrome.debugger.detach(target),
  async sendCommand(target, method, parameters) {
    const result: unknown = await chrome.debugger.sendCommand(target, method, parameters);
    return nativeMessage.parse(result ?? {});
  },
};
