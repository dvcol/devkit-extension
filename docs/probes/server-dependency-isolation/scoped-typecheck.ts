import type { DevframeScopedNodeContext } from 'devframe';
import type { DevframeScopedClientRpc } from 'devframe/client';

declare module 'devframe' {
  interface DevframeRpcSharedStates {
    'typed:counter': { value: number };
    'elsewhere:name': { value: string };
  }
}

export async function verifyScopedTypes(
  node: DevframeScopedNodeContext<'typed'>,
  browser: DevframeScopedClientRpc<'typed'>,
) {
  const nodeState = await node.rpc.sharedState('counter');
  const browserState = await browser.sharedState('counter');
  const nodeNumber: number = nodeState.value().value;
  const browserNumber: number = browserState.value().value;
  // @ts-expect-error A scoped node state must retain its numeric registry value.
  const nodeString: string = nodeState.value().value;
  // @ts-expect-error A scoped browser state must retain its numeric registry value.
  const browserString: string = browserState.value().value;
  return { nodeNumber, browserNumber, nodeString, browserString };
}
