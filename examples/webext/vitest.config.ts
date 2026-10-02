import { defineConfig } from 'vitest/config';

/** Bundle tests explicitly load the production config; unit tests retain native env stubbing. */
export default defineConfig({
  resolve: { dedupe: ['@devframes/json-render'] },
  test: {
    root: import.meta.dirname,
    /** Transform packaged publications so Vite applies the same native module identity as the host. */
    server: { deps: { inline: ['@devkit/example-json-render', '@devframes/json-render'] } },
  },
});
