import { connectDevframe, DevframeConnectionError } from 'devframe/client'

function show(value: unknown): void {
  const output = document.querySelector('pre')
  if (output) output.textContent = JSON.stringify(value, null, 2)
}

async function report(phase: string, value: unknown): Promise<void> {
  const response = await fetch(`/__probe-control/${phase}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  })
  if (!response.ok) throw new Error(`Reporting ${phase} failed: ${response.status}`)
}

function observeValue(expected: number) {
  let resolve!: () => void
  const promise = new Promise<void>((resolveValue) => { resolve = resolveValue })
  return { promise, accept(value: number) { if (value === expected) resolve() } }
}

async function runBrowserProbe(): Promise<void> {
  const client = await connectDevframe({ baseURL: '/__probe/', webmcp: false, simpleAuth: false, otpParam: false, callTimeout: 10000 })
  let unsubscribe: (() => void) | undefined
  try {
    await client.ensureTrusted(10000)
    const state = await client.sharedState.get('probe:counter')
    const initialState = state.value().value
    const stateValues: number[] = []
    const seven = observeValue(7)
    const eleven = observeValue(11)
    unsubscribe = state.on('updated', (value) => {
      stateValues.push(value.value)
      seven.accept(value.value)
      eleven.accept(value.value)
      show({ phase: 'state update', stateValues })
    })
    const actionReturn = await client.call('probe:increment', 7)
    await seven.promise
    let actionFailureRejected = false
    try { await client.call('probe:fail') }
    catch (error) { actionFailureRejected = error instanceof Error && error.message.includes('deliberate-preview-action-failure') }
    await report('started', { transport: client.transport, initialState, actionReturn, actionFailureRejected, userAgent: navigator.userAgent })
    await eleven.promise
    await report('live', { stateValues })
    const pending = await client.call('probe:pending').then(
      () => ({ pendingStatus: 'resolved' }),
      (error: unknown) => ({ pendingStatus: 'rejected', errorKind: error instanceof DevframeConnectionError ? error.kind : undefined, errorMessage: error instanceof Error ? error.message : String(error) }),
    )
    await report('closed', { ...pending, stateValues, connectionStatus: client.status })
    show({ phase: 'completed', initialState, actionReturn, actionFailureRejected, ...pending, stateValues })
  }
  finally {
    unsubscribe?.()
    client.close?.()
  }
}

void runBrowserProbe().catch(async (error: unknown) => {
  const failure = { phase: 'failed', message: error instanceof Error ? error.stack : String(error) }
  show(failure)
  await report('failure', failure).catch(() => {})
})
