import { appendFileSync, cpSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { styleText } from 'node:util'
import { build } from 'vite'
import { atomicJson, pathsFor, readStatus, selectedMode, type BuildStatus } from './common.ts'

const mode = selectedMode()
const paths = pathsFor(mode)
mkdirSync(paths.state, { recursive: true })
mkdirSync(paths.served, { recursive: true })
let attempt = 0
let snapshotGeneration: string | undefined
let generation = readStatus(paths.status)?.generation ?? null

function status(phase: BuildStatus['phase'], error: string | null = null): void {
  atomicJson(paths.status, { phase, attempt, generation, error, processId: process.pid } satisfies BuildStatus)
}

const buildResult = await build({
  root: paths.fixture,
  configFile: false,
  publicDir: false,
  base: './',
  logLevel: 'warn',
  build: {
    outDir: mode === 'raw' ? join(paths.served, 'raw-current') : paths.staging,
    emptyOutDir: true,
    watch: {},
  },
  plugins: [{
    name: 'bounded-generation-publication-probe',
    buildStart() {
      attempt += 1
      snapshotGeneration = undefined
      status('building')
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        if (Object.values(bundle).some(output => output.type === 'chunk' && output.code.includes('TRIGGER_RENDER_FAILURE'))) {
          this.error('Intentional real generateBundle failure after output-directory preparation')
        }
      },
    },
    writeBundle() {
      if (mode === 'raw') return
      const candidate = `generation-${process.pid}-${attempt}`
      const snapshotRoot = join(paths.served, 'generations')
      const temporary = join(snapshotRoot, `.${candidate}`)
      const complete = join(snapshotRoot, candidate)
      mkdirSync(snapshotRoot, { recursive: true })
      cpSync(paths.staging, temporary, { recursive: true })
      renameSync(temporary, complete)
      snapshotGeneration = candidate
    },
  }],
})

if (!('on' in buildResult)) throw new Error('Vite did not return its real build watcher')
const watcher = buildResult
watcher.on('event', (event) => {
  appendFileSync(join(paths.state, 'watch-events.jsonl'), `${JSON.stringify({ code: event.code, attempt, time: Date.now() })}\n`)
  if (event.code === 'ERROR') {
    status('failed', event.error.message)
    return
  }
  if (event.code !== 'BUNDLE_END') return
  if (mode === 'published' && !snapshotGeneration) throw new Error('Completed build has no complete snapshot')
  generation = mode === 'raw' ? 'raw-current' : snapshotGeneration!
  status('ready')
  console.info(styleText('cyan', '🧪 [build-watch]'), mode, 'published completed build', attempt, generation)
})

let stopping = false
async function stop(): Promise<void> {
  if (stopping) return
  stopping = true
  await watcher.close()
  status('stopped')
  atomicJson(join(paths.state, 'watcher-stopped.json'), { processId: process.pid, closed: true })
}
process.on('SIGTERM', () => { void stop() })
process.on('SIGINT', () => { void stop() })
process.on('SIGUSR2', () => { void stop() })
