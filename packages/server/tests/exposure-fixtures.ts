import type { DevframeHubContext } from '@devframes/hub/node';
import { getRpcHandler } from 'devframe/rpc';

/** Resolve the real collector handler, including native schemas; socket tests own auth evidence. */
export async function invokeExposed(
  context: DevframeHubContext,
  name: string,
  ...arguments_: readonly unknown[]
): Promise<unknown> {
  const definition = context.rpc.get(name);
  if (definition === undefined) throw new Error(`Missing native definition ${name}`);
  const handler: unknown = await getRpcHandler(definition, context);
  if (typeof handler !== 'function') throw new Error(`Missing native method ${name}`);
  const returned: unknown = Reflect.apply(handler, undefined, arguments_);
  return returned;
}
