import { platform } from 'node:os';
export function readPlatform(): string { return platform(); }
