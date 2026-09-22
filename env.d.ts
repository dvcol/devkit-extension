declare global {
  namespace NodeJS {
    interface ProcessEnv extends ImportMetaEnv {
      PORT?: string;
      NODE_ENV?: 'development' | 'production';
    }
  }
}

export {};
