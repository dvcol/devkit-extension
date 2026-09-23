export interface CounterState {
  endpoint: string;
  value: number;
}
export interface CounterReceipt extends CounterState {
  credentialKind: string;
}
declare module 'devframe' {
  interface DevframeRpcServerFunctions {
    'probe:increment': (amount: number) => CounterReceipt;
    'probe:receipt': () => CounterReceipt;
  }
  interface DevframeRpcSharedStates {
    'probe:counter': CounterState;
  }
}
