import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const environment = Object.freeze({
  dev: 'development' as const,
  prod: 'production' as const,
});

export const getDirName = () => dirname(fileURLToPath(import.meta.url));
export const isDev: boolean = process.env.NODE_ENV === environment.dev;
export const port: number = Number.parseInt(process.env.PORT ?? '', 10) || 3303;
export const resolveParent = (...args: string[]) => resolve(getDirName(), '..', ...args);

export const isWeb = process.env.VITE_WEB === 'true';
export const sourcemap = process.env.VITE_SOURCEMAP === 'true';
export const outDir = isWeb ? 'build' : 'dist';
