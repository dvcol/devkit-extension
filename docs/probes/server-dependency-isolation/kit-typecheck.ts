import type { KitNodeContext } from '@vitejs/devtools-kit';
import { createKitContext } from '@vitejs/devtools-kit/node';
import type { DevframeHost } from 'devframe';
import { initHub } from '@devframes/hub/initiate';
import type { PreviewServer } from 'vite';

export async function attachTypedKit(host: DevframeHost, preview: PreviewServer) {
  const context: KitNodeContext = await createKitContext({ host, mode: 'dev', cwd: preview.config.root, viteConfig: preview.config });
  const hub = initHub({ context, base: '/__tools/' });
  return { context, hub };
}
