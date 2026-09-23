declare module 'web-ext' {
  interface ExtensionRunner { exit(): Promise<void>; }
  export const cmd: {
    run(options: { sourceDir: string; firefox: string; args: string[]; startUrl: string[]; noInput: boolean; noReload: boolean }, program: { shouldExitProgram: false }): Promise<ExtensionRunner>;
  };
}
