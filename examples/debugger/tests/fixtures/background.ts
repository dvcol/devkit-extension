import { z } from 'zod';
import { checkChromium, checkUnavailable } from './run.js';

declare const DEBUGGER_BROWSER: 'chromium' | 'firefox';
const requestSchema = z.object({ kind: z.literal('run'), targetUrl: z.url() });
let running = false;

/** This packaged document is test instrumentation, not a contribution UI or public RPC API. */
function receive(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (response: unknown) => void,
): boolean {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('probe.html'))
    return false;
  const request = requestSchema.safeParse(message);
  if (!request.success || running) return false;
  running = true;
  const task =
    DEBUGGER_BROWSER === 'firefox' ? checkUnavailable() : checkChromium(request.data.targetUrl);
  void task
    .then(
      (result) => {
        respond({ passed: true, result });
        return true;
      },
      (error: unknown) => {
        respond({ passed: false, error: String(error) });
        return false;
      },
    )
    .finally(() => {
      running = false;
    });
  return true;
}

// oxlint-disable-next-line typescript/strict-void-return -- Chrome requires true to retain the asynchronous sendResponse channel; @types/chrome declares void.
chrome.runtime.onMessage.addListener(receive);
