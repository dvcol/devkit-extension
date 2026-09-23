import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { Server as HttpServer } from 'node:http'
import { join } from 'node:path'
import { styleText } from 'node:util'
import { initHub, type HubInstance } from '@devframes/hub/initiate'
import type { DevframeNodeContext } from 'devframe'
import { createDefineWrapperWithContext } from 'devframe/rpc'
import { s } from 'devframe/utils/simple-schema'
import type { SharedState } from 'devframe/utils/shared-state'
import { build, preview, type PreviewServer } from 'vite'

declare module 'devframe' {
  interface DevframeRpcServerFunctions {
    'probe:increment': (amount: number) => number
    'probe:fail': () => never
    'probe:pending': () => Promise<never>
  }
  interface DevframeRpcSharedStates {
    'probe:counter': { value: number }
  }
}

interface ProbeResult {
  startedAt: string
  finishedAt?: string
  passed: boolean
  nodeVersion: string
  packages: Record<string, string>
  observations: Record<string, unknown>
  errors: string[]
}

const root = import.meta.dirname
const defineNodeRpcFunction = createDefineWrapperWithContext<DevframeNodeContext>()
const result: ProbeResult = {
  startedAt: new Date().toISOString(),
  passed: false,
  nodeVersion: process.version,
  packages: { devframe: '1.0.0', '@devframes/hub': '1.0.0', vite: '8.3.0' },
  observations: {},
  errors: [],
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((resolveValue) => { resolve = resolveValue })
  return { promise, resolve }
}

async function bounded<Value>(promise: Promise<Value>, label: string, milliseconds = 5000): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds)
      }),
    ])
  }
  finally {
    if (timer) clearTimeout(timer)
  }
}

async function main(): Promise<void> {
  let previewServer: PreviewServer | undefined
  let hub: HubInstance | undefined
  let detachUpgrade: (() => void) | undefined
  let routeEnabled = true
  let hubClosed = false
  let serverState: SharedState<{ value: number }> | undefined
  let handlerCalls = 0
  let upgradeListenersBefore = 0
  const enteredPendingHandler = deferred<void>()
  const browserStarted = deferred<Record<string, unknown>>()
  const browserLive = deferred<Record<string, unknown>>()
  const browserClosed = deferred<Record<string, unknown>>()
  try {
    await build({ root, configFile: false, logLevel: 'warn', build: { outDir: 'dist', emptyOutDir: true } })
    console.info(styleText('cyan', '🧪 [preview-probe]'), 'Production HTML built; starting actual Vite PreviewServer')

    previewServer = await preview({
      root,
      configFile: false,
      logLevel: 'warn',
      preview: { host: '127.0.0.1', port: 0, strictPort: true },
      plugins: [{
        name: 'bounded-live-hub-preview-probe',
        async configurePreviewServer(server) {
          assert.ok(server.httpServer instanceof HttpServer)
          upgradeListenersBefore = server.httpServer.listenerCount('upgrade')
          const currentHub = initHub({
            base: '/__probe/',
            cwd: root,
            auth: false,
            mcp: false,
            register: false,
            sse: false,
            getStorageDir: scope => join(root, 'storage', scope),
            async configure(context) {
              result.observations.hostMode = context.mode
              serverState = await context.rpc.sharedState.get('probe:counter', { initialValue: { value: 0 } })
              context.rpc.register(defineNodeRpcFunction({
                name: 'probe:increment',
                type: 'action',
                args: [s.number()] as const,
                returns: s.number(),
                jsonSerializable: true,
                handler(amount) {
                  handlerCalls += 1
                  assert.ok(serverState)
                  serverState.mutate(state => { state.value += amount })
                  return serverState.value().value
                },
              }))
              context.rpc.register({ name: 'probe:fail', handler() { throw new Error('deliberate-preview-action-failure') } })
              context.rpc.register({
                name: 'probe:pending',
                handler() {
                  enteredPendingHandler.resolve()
                  return new Promise<never>(() => {})
                },
              })
            },
          })
          hub = currentHub
          detachUpgrade = currentHub.attach(server.httpServer)
          server.middlewares.use((request, response, next) => {
            if (!request.url?.startsWith('/__probe-control/')) return next()
            const receive = async () => {
              const chunks: Buffer[] = []
              for await (const chunk of request) chunks.push(Buffer.from(chunk))
              const payload = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>
              response.setHeader('Content-Type', 'application/json')
              response.end('{}')
              if (request.url === '/__probe-control/started') browserStarted.resolve(payload)
              else if (request.url === '/__probe-control/live') browserLive.resolve(payload)
              else if (request.url === '/__probe-control/closed') browserClosed.resolve(payload)
              else result.errors.push(JSON.stringify(payload))
            }
            void receive().catch(next)
          })
          server.middlewares.use((request, response, next) => {
            if (!routeEnabled) return next()
            currentHub.nodeMiddleware(request, response, next)
          })
          await bounded(currentHub.ready, 'hub ready')
        },
      }],
    })

    const address = previewServer.httpServer.address()
    assert.ok(address && typeof address === 'object')
    const origin = `http://127.0.0.1:${address.port}`
    result.observations.origin = origin
    const builtPage = await fetch(origin).then(response => response.text())
    assert.ok(builtPage.includes('built-preview-marker-v1'))
    assert.ok(builtPage.includes('/assets/'))
    const metadata = await fetch(`${origin}/__probe/__connection.json`).then(response => response.json())
    assert.equal(metadata.backend, 'websocket')
    result.observations.metadata = metadata
    result.observations.upgradeListenersBefore = upgradeListenersBefore
    result.observations.upgradeListenersAttached = previewServer.httpServer.listenerCount('upgrade')
    assert.equal(previewServer.httpServer.listenerCount('upgrade'), upgradeListenersBefore + 1)

    await writeFile(join(root, 'running.json'), JSON.stringify({ origin, processId: process.pid }))
    console.info(styleText('cyan', '🧪 [preview-probe]'), 'Open the isolated browser probe:', origin)
    const startedReport = await bounded(browserStarted.promise, 'actual browser client start', 180000)
    assert.equal(startedReport.transport, 'websocket')
    assert.equal(startedReport.initialState, 0)
    assert.equal(startedReport.actionReturn, 7)
    assert.equal(startedReport.actionFailureRejected, true)
    assert.equal(handlerCalls, 1)
    assert.ok(serverState)
    assert.equal(serverState.value().value, 7)
    serverState.mutate(state => { state.value = 11 })
    const liveReport = await bounded(browserLive.promise, 'server-driven browser state broadcast')
    assert.deepEqual(liveReport.stateValues, [7, 11])
    result.observations.handlerCalls = handlerCalls
    result.observations.browserStarted = startedReport
    result.observations.browserLive = liveReport
    console.info(styleText('cyan', '🧪 [preview-probe]'), 'Live action and two state broadcasts passed over the preview HTTP server WebSocket')

    await bounded(enteredPendingHandler.promise, 'pending handler started')
    routeEnabled = false
    assert.ok(detachUpgrade)
    detachUpgrade()
    detachUpgrade = undefined
    assert.ok(hub)
    await bounded(hub.close(), 'hub close')
    hubClosed = true
    const interruptedCall = await bounded(browserClosed.promise, 'browser pending call rejection')
    assert.equal(interruptedCall.pendingStatus, 'rejected')
    assert.equal(interruptedCall.errorKind, 'connection')
    assert.equal(previewServer.httpServer.listenerCount('upgrade'), upgradeListenersBefore)
    assert.equal(previewServer.httpServer.listening, true)
    const builtPageAfterHubClose = await fetch(origin).then(response => response.text())
    assert.ok(builtPageAfterHubClose.includes('built-preview-marker-v1'))
    const removedMetadataResponse = await fetch(`${origin}/__probe/__connection.json`)
    assert.ok(!(removedMetadataResponse.headers.get('content-type') ?? '').includes('application/json'))
    result.observations.pendingCallAfterHubClose = interruptedCall
    result.observations.upgradeListenersAfterDetach = previewServer.httpServer.listenerCount('upgrade')
    result.observations.previewSurvivedHubClose = true
    result.observations.metadataRouteDisabled = true
    result.observations.closedClientStatus = interruptedCall.connectionStatus
    await bounded(previewServer.close(), 'preview close')
    assert.equal(previewServer.httpServer.listening, false)
    result.observations.previewStopped = true
    previewServer = undefined
    result.passed = true
    console.info(styleText('cyan', '🧪 [preview-probe]'), 'Hub detached; built preview survived; preview then stopped')
  }
  finally {
    routeEnabled = false
    detachUpgrade?.()
    if (hub && !hubClosed) await bounded(hub.close(), 'final hub cleanup').catch(error => result.errors.push(String(error)))
    if (previewServer) {
      if (previewServer.httpServer instanceof HttpServer) previewServer.httpServer.closeAllConnections()
      await bounded(previewServer.close(), 'final preview cleanup').catch(error => result.errors.push(String(error)))
      result.observations.previewStopped = !previewServer.httpServer.listening
    }
  }
}

try {
  await main()
}
catch (error) {
  result.errors.push(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
}
finally {
  result.finishedAt = new Date().toISOString()
  await writeFile(join(root, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.info(styleText('cyan', '🧪 [preview-probe]'), JSON.stringify(result))
}
