/// <reference types="vite/client" />

interface ImportMetaEnv extends ImportMetaEnv {
  BASE_URL: string;
  MODE: string;
  DEV: boolean;
  PROD: boolean;
  SSR: boolean;

  PKG_VERSION?: string;
  PKG_NAME?: string;

  VITE_BASE?: string;
  VITE_WEB?: boolean;
  VITE_SOURCEMAP?: boolean;
};

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
