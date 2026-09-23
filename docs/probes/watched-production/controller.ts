import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { styleText } from 'node:util'
import { atomicJson, pathsFor, type BuildStatus, type ProbeMode } from './common.ts'

interface Snapshot {
  status: number
  url: string
  html: string
  assets: Array<{ url: string, status: number, hash: string, body: string }>
}

async function waitFor<Value>(read: () => Promise<Value>, accepts: (value: Value) => boolean, label: string): Promise<Value> {
  const expires = Date.now() + 30000
  while (Date.now() < expires) {
    try {
      const value = await read()
      if (accepts(value)) return value
    }
    catch {}
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function snapshot(origin: string): Promise<Snapshot> {
  const response = await fetch(origin, { cache: 'no-store', signal: AbortSignal.timeout(3000) })
  const html = await response.text()
  const references = [...html.matchAll(/(?:src|href)="([^"\s]+\.(?:js|css))"/g)]
  const assets = []
  for (const reference of references) {
    const url = new URL(reference[1]!, response.url).href
    const asset = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(3000) })
    const body = await asset.text()
    assets.push({ url, status: asset.status, hash: createHash('sha256').update(body).digest('hex'), body })
  }
  return { status: response.status, url: response.url, html, assets }
}

function source(marker: string, lateFailure = false): string {
  const extra = lateFailure ? 'document.body.dataset.failure = "TRIGGER_RENDER_FAILURE";' : ''
  return `import './style.css'; document.body.dataset.generation = ${JSON.stringify(marker)}; ${extra}\n`
}

function assertComplete(snapshot: Snapshot, marker: string): void {
  assert.equal(snapshot.status, 200)
  assert.equal(snapshot.assets.length, 2)
  assert.ok(snapshot.assets.every(asset => asset.status === 200))
  assert.ok(snapshot.assets.some(asset => asset.body.includes(marker)))
}

async function scenario(mode: ProbeMode): Promise<Record<string, unknown>> {
  const paths = pathsFor(mode)
  mkdirSync(paths.fixture, { recursive: true })
  mkdirSync(paths.state, { recursive: true })
  writeFileSync(join(paths.fixture, 'index.html'), '<!doctype html><html><head><title>Watched publication probe</title></head><body><h1>Watched publication probe</h1><script type="module" src="/main.ts"></script></body></html>')
  writeFileSync(join(paths.fixture, 'style.css'), 'body { color: rgb(10, 20, 30); }\n')
  writeFileSync(join(paths.fixture, 'main.ts'), source('good-one'))
  const log = join(paths.scenario, 'pipeline.log')
  const children = ['dev:production'].map(script => {
    const child = spawn('pnpm', ['run', script], {
      cwd: import.meta.dirname, env: { ...process.env, PROBE_MODE: mode }, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', chunk => appendFileSync(log, chunk))
    child.stderr.on('data', chunk => appendFileSync(log, chunk))
    return child
  })
  let origin: string | undefined
  let builderProcessId: number | undefined
  let previewProcessId: number | undefined
  const observations: Record<string, unknown> = {}
  try {
    const connection = await waitFor(async () => JSON.parse(readFileSync(paths.preview, 'utf8')) as { origin: string, processId: number }, value => !!value.origin, 'preview startup')
    origin = connection.origin
    previewProcessId = connection.processId
    const read = async () => fetch(`${origin}/__build-status`, { cache: 'no-store', signal: AbortSignal.timeout(3000) }).then(response => response.json()) as Promise<BuildStatus>
    const first = await waitFor(read, value => value.phase === 'ready', 'first completed build')
    builderProcessId = first.processId
    const goodOne = await snapshot(origin)
    assertComplete(goodOne, 'good-one')
    observations.initial = { build: first, snapshot: goodOne }

    writeFileSync(join(paths.fixture, 'main.ts'), 'export const broken = ;\n')
    const syntaxFailure = await waitFor(read, value => value.attempt > first.attempt && value.phase === 'failed', 'actual syntax error')
    const afterSyntaxFailure = await snapshot(origin)
    observations.syntaxFailure = { build: syntaxFailure, snapshot: afterSyntaxFailure }
    if (mode === 'published') {
      assert.equal(syntaxFailure.generation, first.generation)
      assert.deepEqual(afterSyntaxFailure, goodOne)
    }

    writeFileSync(join(paths.fixture, 'main.ts'), source('good-two'))
    const second = await waitFor(read, value => value.attempt > syntaxFailure.attempt && value.phase === 'ready', 'syntax-error recovery')
    const goodTwo = await snapshot(origin)
    assertComplete(goodTwo, 'good-two')
    observations.firstRecovery = { build: second, snapshot: goodTwo }

    writeFileSync(join(paths.fixture, 'main.ts'), source('failed-three', true))
    const lateFailure = await waitFor(read, value => value.attempt > second.attempt && value.phase === 'failed', 'actual generateBundle error')
    const afterLateFailure = await snapshot(origin)
    observations.lateFailure = { build: lateFailure, snapshot: afterLateFailure }
    if (mode === 'published') {
      assert.equal(lateFailure.generation, second.generation)
      assert.deepEqual(afterLateFailure, goodTwo)
    }

    writeFileSync(join(paths.fixture, 'main.ts'), source('good-four'))
    const fourth = await waitFor(read, value => value.attempt > lateFailure.attempt && value.phase === 'ready', 'late-failure recovery')
    const goodFour = await snapshot(origin)
    assertComplete(goodFour, 'good-four')
    observations.secondRecovery = { build: fourth, snapshot: goodFour }
    if (mode === 'published') {
      assert.notEqual(fourth.generation, second.generation)
      const retained = []
      for (const asset of goodOne.assets) {
        const response = await fetch(asset.url)
        const hash = createHash('sha256').update(await response.text()).digest('hex')
        assert.equal(response.status, 200)
        assert.equal(hash, asset.hash)
        retained.push({ url: asset.url, status: response.status, hash })
      }
      observations.originalGenerationAssetsStillAvailable = retained
    }
    observations.watchEvents = readFileSync(join(paths.state, 'watch-events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    console.info(styleText('cyan', '🧪 [controller]'), mode, 'completed real watcher success/failure/recovery sequence')
  }
  finally {
    for (const processId of [builderProcessId, previewProcessId]) {
      if (processId) {
        try { process.kill(processId, 'SIGUSR2') } catch {}
      }
    }
    try {
      await waitFor(async () => Boolean(readOptional(join(paths.state, 'watcher-stopped.json')) && readOptional(join(paths.state, 'preview-stopped.json'))), value => value, 'both public close handles')
    }
    catch {}
    await delay(100)
    for (const child of children) {
      if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL') } catch {}
      }
    }
    const processAbsent = (processId: number | undefined) => {
      if (!processId) return null
      try { process.kill(processId, 0); return false } catch { return true }
    }
    let refused = false
    if (origin) {
      try { await fetch(origin, { signal: AbortSignal.timeout(2000) }) }
      catch (error) {
        refused = error instanceof Error && error.cause instanceof Error && 'code' in error.cause && error.cause.code === 'ECONNREFUSED'
      }
    }
    const cleanup = {
      builderAbsent: processAbsent(builderProcessId), previewAbsent: processAbsent(previewProcessId), connectionRefused: refused,
      watcher: readOptional(join(paths.state, 'watcher-stopped.json')),
      preview: readOptional(join(paths.state, 'preview-stopped.json')),
    }
    observations.cleanup = cleanup
    atomicJson(join(paths.scenario, 'result.json'), observations)
    assert.equal(cleanup.builderAbsent, true)
    assert.equal(cleanup.previewAbsent, true)
    assert.equal(cleanup.connectionRefused, true)
    assert.ok(cleanup.watcher)
    assert.ok(cleanup.preview)
  }
  return observations
}

function readOptional(path: string): string | null {
  try { return readFileSync(path, 'utf8') } catch { return null }
}

const result: Record<string, unknown> = { startedAt: new Date().toISOString(), nodeVersion: process.version, packages: { vite: '8.3.0', pnpm: '12.5.1' }, packageManager: { executable: process.env.npm_execpath, userAgent: process.env.npm_config_user_agent }, launcher: 'pnpm --workspace-concurrency=2 run /^(build:watch|preview)$/' }
try {
  result.raw = await scenario('raw')
  result.published = await scenario('published')
  result.passed = true
}
catch (error) {
  result.error = error instanceof Error ? error.stack : String(error)
  result.passed = false
  process.exitCode = 1
}
finally {
  result.finishedAt = new Date().toISOString()
  atomicJson(join(import.meta.dirname, 'result.json'), result)
  console.info(styleText('cyan', '🧪 [controller]'), JSON.stringify({ passed: result.passed, error: result.error }))
}
