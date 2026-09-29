import type { PublishedTarget } from '@dvcol/cdb';
import { createChromeProvider } from '@dvcol/cdb-extension/chrome';
import { deferred } from '../native-boundary.js';
import { chromeBoundary } from './chrome.js';
import { createConnection } from './connection.js';
import type { RecoveryFixtureOptions } from './definition.js';

export function createRecoveryFixture(options: RecoveryFixtureOptions = {}) {
  const calls: string[] = [];
  const outcome = deferred<{ readonly error?: unknown }>();
  const publications: PublishedTarget[] = [];
  let failure: unknown;
  const connection = createConnection(publications);
  chromeBoundary(options, calls);
  const provider = createChromeProvider({
    connect: () => Promise.resolve(connection),
    maximumLevel: 'debug',
    recoveryStorageKey: 'recovery',
    authorizeApproval: () => false,
    onState() {
      outcome.resolve({});
    },
    onError(error) {
      failure = error;
      outcome.resolve({ error });
    },
  });
  provider.start();
  return { calls, outcome: outcome.promise, publications, provider, error: () => failure };
}
