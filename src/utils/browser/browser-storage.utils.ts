import { localStorage, sessionStorage, storageWrapper, syncStorage } from '@dvcol/web-extension-utils/chrome/storage';

/**
 * This object is used to access the storage areas.
 */
export const storage = {
  sync: storageWrapper('sync', syncStorage),
  local: storageWrapper('local', localStorage),
  session: storageWrapper('session', sessionStorage),
};
