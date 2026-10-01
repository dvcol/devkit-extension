import { defineConfig } from 'vitest/config';

/** Bundle tests explicitly load the production config; unit tests retain native env stubbing. */
export default defineConfig({ test: { root: import.meta.dirname } });
