import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { styleText } from 'node:util'
import { preview } from 'vite'
import { atomicJson, pathsFor, readStatus, selectedMode } from './common.ts'

const mode = selectedMode()
const paths = pathsFor(mode)
mkdirSync(paths.served, { recursive: true })
const server = await preview({
  root: paths.fixture,
  configFile: false,
  logLevel: 'warn',
  build: { outDir: paths.served },
  preview: { host: '127.0.0.1', port: 0, strictPort: true },
  plugins: [{
    name: 'bounded-generation-routing-probe',
    configurePreviewServer(previewServer) {
      previewServer.middlewares.use((request, response, next) => {
        const status = readStatus(paths.status)
        if (request.url === '/__build-status') {
          response.setHeader('Cache-Control', 'no-store')
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify(status ?? { phase: 'starting', generation: null }))
          return
        }
        if (request.url !== '/' && request.url !== '/index.html') return next()
        response.setHeader('Cache-Control', 'no-store')
        if (!status?.generation) {
          response.statusCode = 503
          response.end('No completed build is available yet')
          return
        }
        const directory = mode === 'raw' ? 'raw-current' : `generations/${status.generation}`
        response.statusCode = 302
        response.setHeader('Location', `/${directory}/index.html`)
        response.end()
      })
    },
  }],
})
const address = server.httpServer.address()
assert.ok(address && typeof address === 'object')
const origin = `http://127.0.0.1:${address.port}`
atomicJson(paths.preview, { origin, processId: process.pid })
console.info(styleText('cyan', '🧪 [preview]'), mode, origin)
let stopping = false
async function stop(): Promise<void> {
  if (stopping) return
  stopping = true
  await server.close()
  atomicJson(join(paths.state, 'preview-stopped.json'), { processId: process.pid, closed: true, listening: server.httpServer.listening })
}
process.on('SIGTERM', () => { void stop() })
process.on('SIGINT', () => { void stop() })
process.on('SIGUSR2', () => { void stop() })
