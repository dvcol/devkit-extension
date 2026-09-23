import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type ProbeMode = 'raw' | 'published'
export interface BuildStatus {
  phase: 'building' | 'ready' | 'failed' | 'stopped'
  attempt: number
  generation: string | null
  error: string | null
  processId: number
}

export function pathsFor(mode: ProbeMode) {
  const scenario = join(import.meta.dirname, '.runs', mode)
  return {
    scenario,
    fixture: join(scenario, 'fixture'),
    staging: join(scenario, 'staging'),
    served: join(scenario, 'served'),
    state: join(scenario, 'state'),
    status: join(scenario, 'state', 'status.json'),
    preview: join(scenario, 'state', 'preview.json'),
  }
}

export function selectedMode(): ProbeMode {
  const mode = process.env.PROBE_MODE ?? 'published'
  if (mode !== 'raw' && mode !== 'published') throw new Error(`Invalid PROBE_MODE: ${mode}`)
  return mode
}

export function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.temporary-${process.pid}`
  writeFileSync(temporaryPath, JSON.stringify(value, null, 2))
  renameSync(temporaryPath, path)
}

export function readStatus(path: string): BuildStatus | undefined {
  try { return JSON.parse(readFileSync(path, 'utf8')) as BuildStatus }
  catch { return undefined }
}
