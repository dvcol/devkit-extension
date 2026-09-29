import type { AgentToBrokerMessage, BrokerToAgentMessage, PublishedTarget } from '@dvcol/cdb';
import type { ProviderConnection } from '@dvcol/cdb-extension';
import { vi } from 'vitest';
import { deferred } from '../native-boundary.js';
import { brokerState } from './definition.js';

type AgentHello = Extract<AgentToBrokerMessage, { method: 'agent.hello' }>;

function helloResponse(message: AgentHello): BrokerToAgentMessage {
  return {
    kind: 'response',
    method: 'agent.hello',
    requestId: message.requestId,
    protocolVersion: 1,
    result: {
      connectionGeneration: 2,
      protocolVersion: 1,
      features: [],
      broker: { name: 'Broker', version: '1', instanceId: 'broker', role: 'broker' },
      heartbeat: { intervalMilliseconds: 15_000, timeoutMilliseconds: 45_000 },
      limits: {
        maximumArtifactBytes: 16_777_216,
        maximumInlineResultBytes: 65_536,
        maximumMessageBytes: 67_108_864,
      },
    },
  };
}

function messageBoundary(publications: PublishedTarget[]) {
  const listeners = new Set<(message: BrokerToAgentMessage) => void>();
  return {
    onMessage(listener: (message: BrokerToAgentMessage) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    send(message: AgentToBrokerMessage) {
      if (message.kind === 'request' && message.method === 'agent.hello') {
        for (const listener of listeners) listener(helloResponse(message));
      }
      if (message.kind === 'notification' && message.method === 'targets.publish')
        publications.push(message.parameters.target);
      return Promise.resolve();
    },
  };
}

export function createConnection(publications: PublishedTarget[]): ProviderConnection {
  const closed = deferred<{ code: number; reason: string }>();
  return {
    ...messageBoundary(publications),
    brokerId: 'broker',
    generation: 2,
    registration: {
      id: 'provider',
      instanceId: 'installation',
      maximumLevel: 'debug',
      name: 'Provider',
      version: '1',
    },
    closed: closed.promise,
    close(code = 1000, reason = 'closed') {
      closed.resolve({ code, reason });
    },
    snapshot: () => Promise.resolve(brokerState),
    claim: () => Promise.reject(new Error('Restoration must not require another approval.')),
    release: () => Promise.resolve(),
    approve: () => Promise.resolve(brokerState),
    reconcile: () => Promise.resolve(brokerState),
    reconcileScope: () => Promise.resolve(),
    revokeScope: () => Promise.resolve(),
    watch(listener) {
      listener(brokerState);
      return Promise.resolve(vi.fn<() => void>());
    },
  };
}
