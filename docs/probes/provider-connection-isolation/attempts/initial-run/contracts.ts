export interface CounterReceipt {
  endpoint: string;
  value: number;
  credentialMatched: boolean;
}

declare module 'devframe' {
  interface DevframeRpcServerFunctions {
    'probe:increment': (amount: number) => CounterReceipt;
    'probe:receipt': () => CounterReceipt;
  }
  interface DevframeRpcSharedStates {
    'probe:counter': { endpoint: string; value: number };
  }
}
