import type { ConnectionMeta } from 'devframe/types';
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string');
}
export async function readCredentials(): Promise<{ endpointA: string; endpointB: string }> {
  const value: unknown = await fetch('/__probe-control/bootstrap').then((response) =>
    response.json(),
  );
  if (!isRecord(value) || !isRecord(value.credentials))
    throw new Error('Missing probe credentials');
  const { endpointA, endpointB } = value.credentials;
  if (typeof endpointA !== 'string' || typeof endpointB !== 'string')
    throw new TypeError('Invalid credential values');
  return { endpointA, endpointB };
}
export async function readConnectionMeta(base: string): Promise<ConnectionMeta> {
  const value: unknown = await fetch(`${base}__connection.json`).then((response) =>
    response.json(),
  );
  if (!isRecord(value) || value.backend !== 'websocket')
    throw new TypeError('Unexpected probe backend');
  let websocket: ConnectionMeta['websocket'];
  if (typeof value.websocket === 'string' || typeof value.websocket === 'number')
    websocket = value.websocket;
  else if (isRecord(value.websocket) && typeof value.websocket.path === 'string')
    websocket = { path: value.websocket.path };
  else throw new TypeError('Unexpected probe WebSocket metadata');
  const connectionMeta: ConnectionMeta = { backend: 'websocket', websocket };
  if (value.jsonSerializableMethods !== undefined) {
    if (!isStringArray(value.jsonSerializableMethods))
      throw new TypeError('Invalid serialization method list');
    connectionMeta.jsonSerializableMethods = value.jsonSerializableMethods;
  }
  return connectionMeta;
}
export async function readCode(): Promise<string> {
  const value: unknown = await fetch('/__probe-control/code').then((response) => response.json());
  if (!isRecord(value) || typeof value.code !== 'string')
    throw new TypeError('Missing requested code');
  return value.code;
}
export async function readHandlerCount(): Promise<number> {
  const value: unknown = await fetch('/__probe-control/count').then((response) => response.json());
  if (!isRecord(value) || typeof value.count !== 'number')
    throw new TypeError('Missing handler count');
  return value.count;
}
