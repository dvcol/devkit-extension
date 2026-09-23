import { styleText } from 'node:util';

import type { ServerProviderHandle } from '@devkit/server';
import type { Plugin } from 'vite';

/** Example-local binding to one Vite HTTP server, not a general reload controller. */
export class ProviderLifetime {
  private readonly readiness = Promise.withResolvers<ServerProviderHandle>();
  readonly ready = this.readiness.promise;
  private install: (() => Promise<ServerProviderHandle>) | undefined;
  private activation: Promise<ServerProviderHandle> | undefined;
  private disposal: Promise<void> | undefined;
  private listening = false;
  private closed = false;
  private removeListener: (() => void) | undefined;

  constructor() {
    /** Callers may await readiness after Vite has already closed or failed. */
    void this.ready.catch(() => null);
  }

  prepare(installer: () => Promise<ServerProviderHandle>) {
    if (this.install !== undefined) throw new Error('A native context was already supplied');
    this.install = installer;
    this.activate();
  }

  private activate() {
    if (
      !this.listening ||
      this.closed ||
      this.install === undefined ||
      this.activation !== undefined
    )
      return;
    this.activation = this.install();
    void this.activation.then(this.readiness.resolve, (error: unknown) => {
      console.error(styleText('red', '⚠️ [vite-hosts]'), 'Provider activation failed', error);
      this.readiness.reject(error);
    });
  }

  private async dispose() {
    this.closed = true;
    this.removeListener?.();
    if (this.activation === undefined) {
      this.readiness.reject(new Error('Vite closed before provider activation'));
      return;
    }
    const provider = await this.activation;
    await provider.dispose();
  }

  plugin(): Plugin {
    return {
      name: 'devkit:example-provider',
      apply: 'serve',
      enforce: 'pre',
      api: this,
      configureServer: (server) => {
        const httpServer = server.httpServer;
        if (httpServer === null)
          throw new Error(
            'This example requires a Vite-owned HTTP server; middleware mode is unsupported',
          );
        const onListening = () => {
          this.listening = true;
          this.activate();
        };
        httpServer.once('listening', onListening);
        this.removeListener = () => {
          httpServer.off('listening', onListening);
        };
      },
      closeServer: () => {
        this.disposal ??= this.dispose();
        return this.disposal;
      },
    };
  }
}
