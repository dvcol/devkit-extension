import { setupDevframeConnection } from 'devframe/client';
import { DEVFRAME_CONNECTION_KEY } from 'devframe/constants';

/** Supplied by the loopback test host; never written to fixture files or logs. */
declare const PUBLISHER_AUTH_TOKEN: string;

const mode = new URL(location.href).searchParams.get('mode');
if (mode === 'malformed') {
  Reflect.set(globalThis, DEVFRAME_CONNECTION_KEY, { metaBaseUrl: 42 });
} else if (mode !== 'absent') {
  /** Native shared setup publishes the descriptor. The adopting extension uses an isolated copy. */
  await setupDevframeConnection({ baseURL: '/__devkit-remote/', authToken: PUBLISHER_AUTH_TOKEN });
}
document.querySelector<HTMLOutputElement>('#status')!.textContent = 'Ready';
