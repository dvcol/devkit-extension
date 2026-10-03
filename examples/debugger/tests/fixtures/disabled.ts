import { isOperationError } from '@devkit/core';
import { pageTitleCapability, readPageTitleAction } from '../../src/contracts.ts';
import { installDebuggerContributions } from '../../src/provider.ts';

/** The optional implementation is omitted, even though this fixture runs in Chromium. */
async function checkDisabledProfile() {
  const diagnostics: string[] = [];
  const { provider, startup } = await installDebuggerContributions(undefined, (diagnostic) => {
    diagnostics.push(diagnostic.code);
  });
  try {
    const capability = await provider.resolve({ capability: pageTitleCapability });
    const actionError = await unavailableAction(provider);
    return {
      installedServices: startup.services.length,
      capability: capability.status,
      plugin: startup.plugins[0]?.snapshot(),
      actionError,
      diagnostics,
      nativeDebuggerAvailable: chrome.debugger !== undefined,
      permissions: await chrome.permissions.getAll(),
      manifestPermissions: chrome.runtime.getManifest().permissions ?? [],
    };
  } finally {
    await provider.dispose();
  }
}

async function unavailableAction(
  provider: Awaited<ReturnType<typeof installDebuggerContributions>>['provider'],
) {
  try {
    await provider.invoke({
      action: readPageTitleAction,
      input: { id: crypto.randomUUID(), generation: 1 },
    });
  } catch (error) {
    if (!isOperationError(error)) throw error;
    return { code: error.code, message: error.message };
  }
  throw new Error('The omitted CDB implementation unexpectedly handled an action');
}

function receive(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (response: unknown) => void,
): boolean {
  if (
    message !== 'check-disabled-profile' ||
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL('probe.html')
  )
    return false;
  void checkDisabledProfile().then(
    (result) => {
      respond({ passed: true, result });
      return true;
    },
    (error: unknown) => {
      respond({ passed: false, error: String(error) });
      return false;
    },
  );
  return true;
}

// oxlint-disable-next-line typescript/strict-void-return -- Chrome requires true to retain the asynchronous sendResponse channel; @types/chrome declares void.
chrome.runtime.onMessage.addListener(receive);
