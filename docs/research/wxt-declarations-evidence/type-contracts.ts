import { browser } from 'wxt/browser';
import type { Browser, WxtI18n } from 'wxt/browser';

export function verifyNativeDeclarations(request: Browser.devtools.network.Request) {
  const extensionId: string = browser.i18n.getMessage('@@extension_id');
  const userInterfaceLanguage: string = browser.i18n.getUILanguage();
  const acceptedLanguages: Promise<string[]> = browser.i18n.getAcceptLanguages();
  const requestDuration: number = request.time;
  const archiveTimings: Promise<number[]> = browser.devtools.network.getHAR().then((log) => log.entries.map((entry) => entry.time));

  // @ts-expect-error WXT must keep generated message keys narrow.
  browser.i18n.getMessage('undeclared-message');
  // @ts-expect-error Native i18n method inputs must remain checked.
  browser.i18n.getAcceptLanguages('invalid-input');
  // @ts-expect-error HAR entry members must retain their native types.
  const invalidDuration: string = request.time;

  return { extensionId, userInterfaceLanguage, acceptedLanguages, requestDuration, archiveTimings, invalidDuration };
}

export function verifyDirectI18n(language: WxtI18n) {
  const extensionId: string = language.getMessage('@@extension_id');
  const userInterfaceLanguage: string = language.getUILanguage();
  const acceptedLanguages: Promise<string[]> = language.getAcceptLanguages();
  // @ts-expect-error Direct WxtI18n consumers must keep generated message keys narrow.
  language.getMessage('undeclared-message');
  // @ts-expect-error Direct WxtI18n consumers must retain native argument checking.
  language.getAcceptLanguages('invalid-input');
  return { extensionId, userInterfaceLanguage, acceptedLanguages };
}
