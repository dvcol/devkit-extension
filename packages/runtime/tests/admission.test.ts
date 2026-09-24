import {
  defineActionContract,
  defineAction,
  defineCapability,
  defineContributionKind,
  defineExecution,
  defineExtension,
  defineOperation,
  definePlugin,
  defineService,
} from '@devkit/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createAdmissionRegistry } from '../src/admission';
import type { Admission } from '../src/admission';

const execution = defineExecution({ id: 'test.server' });
const operation = defineOperation({ input: z.string(), output: z.string(), target: 'none' });
const capability = defineCapability({
  id: 'test.echo',
  version: 1,
  operations: { echo: operation },
});

function service(id: string, version = 1) {
  return defineService({
    capability: defineCapability({ id: capability.id, operations: capability.operations, version }),
    id,
    execution,
    setup: () => ({ echo: (input) => input }),
  });
}

function reservationOf(admission: Admission | undefined) {
  if (admission?.status !== 'reserved') throw new Error('Expected reservation');
  return admission.reservation;
}

describe('atomic admission', () => {
  it('rejects an entire startup batch before setup and keeps existing owners', () => {
    expect.assertions(4);
    const setup = vi.fn<() => { echo: (input: string) => string }>(() => ({
      echo: (input) => input,
    }));
    const existing = service('existing');
    const registry = createAdmissionRegistry({ providerId: 'server' });
    registry.reserve({ services: [existing] });
    const candidate = defineService({
      capability: defineCapability({
        id: capability.id,
        operations: capability.operations,
        version: 2,
      }),
      id: 'candidate',
      execution,
      setup,
    });
    expect(() => registry.reserve({ services: [candidate, existing] })).toThrow(
      'already registered',
    );
    expect(setup).not.toHaveBeenCalled();
    expect(registry.reserve({ services: [candidate] })[0]?.status).toBe('reserved');
    expect(() => registry.reserve({ services: [existing] })).toThrow('already registered');
  });

  it('snapshots structural declarations before their mutable aliases can change slots', () => {
    expect.assertions(3);
    const registry = createAdmissionRegistry({ providerId: 'server' });
    const mutableCapability = { ...capability, version: 1 };
    const structural = { ...service('structural'), capability: mutableCapability };
    const first = reservationOf(registry.reserve({ services: [structural] })[0]);
    mutableCapability.version = 2;
    structural.id = 'changed';
    expect(first.services[0]?.capability.version).toBe(1);
    expect(first.services[0]?.id).toBe('structural');
    expect(registry.reserve({ services: [service('second-version', 2)] })[0]?.status).toBe(
      'reserved',
    );
  });

  it('rejects the same service instance twice without an identity exception', () => {
    expect.assertions(2);
    const registry = createAdmissionRegistry({ providerId: 'server' });
    const definition = service('same');
    expect(() => registry.reserve({ services: [definition, definition] })).toThrow(
      'already registered',
    );
    expect(registry.reserve({ services: [definition] })[0]?.status).toBe('reserved');
  });

  it('relaxed duplicate service has no ownership reservation', () => {
    expect.assertions(4);
    const registry = createAdmissionRegistry({ providerId: 'server', strict: false });
    const first = registry.reserve({ services: [service('first')] })[0];
    const duplicate = registry.reserve({ services: [service('duplicate')] })[0];
    expect(duplicate).toMatchObject({
      status: 'skipped',
      diagnostic: { code: 'duplicate-registration', severity: 'warning' },
    });
    expect(duplicate).not.toHaveProperty('reservation');
    expect(first?.status).toBe('reserved');
    registry.release(reservationOf(first));
    expect(registry.reserve({ services: [service('duplicate')] })[0]?.status).toBe('reserved');
  });

  it('relaxed plugin keeps independent declarations and records skipped service', () => {
    expect.assertions(3);
    const registry = createAdmissionRegistry({ providerId: 'server', strict: false });
    const action = defineAction({
      contract: defineActionContract({ id: 'test.action', version: 1, operation }),
      id: 'test.handler',
      execution,
      handler: ({ input }) => input,
    });
    const result = registry.reserve({
      services: [service('host')],
      plugins: [
        definePlugin({ id: 'plugin', services: [service('duplicate')], actions: [action] }),
      ],
    })[1];
    const reservation = reservationOf(result);
    expect(reservation.services).toHaveLength(0);
    expect(reservation.contributions).toEqual([action]);
    expect(reservation.diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', contributionId: 'duplicate' }),
    ]);
  });

  it('allows exact versions to coexist and releases only the selected owner', () => {
    expect.assertions(3);
    const registry = createAdmissionRegistry({ providerId: 'server' });
    const first = registry.reserve({ services: [service('v1'), service('v2', 2)] })[0];
    registry.release(reservationOf(first));
    registry.release(reservationOf(first));
    expect(registry.reserve({ services: [service('replacement')] })[0]?.status).toBe('reserved');
    expect(() => registry.reserve({ services: [service('duplicate-v2', 2)] })).toThrow(
      'already registered',
    );
    expect(() => registry.reserve({ services: [service('duplicate-v1')] })).toThrow(
      'already registered',
    );
  });

  it('rejects a cycle introduced through an already waiting owner', () => {
    expect.assertions(2);
    const other = defineCapability({
      id: 'test.other',
      version: 1,
      operations: capability.operations,
    });
    const first = defineService({
      capability: capability,
      id: 'first',
      execution,
      requires: { other },
      setup: () => ({ echo: (input) => input }),
    });
    const second = defineService({
      capability: other,
      id: 'second',
      execution,
      requires: { first: capability },
      setup: () => ({ echo: (input) => input }),
    });
    const registry = createAdmissionRegistry({ providerId: 'server', strict: false });
    registry.reserve({ services: [first] });
    expect(() => registry.reserve({ services: [second] })).toThrow('cycle');
    const independent = defineService({
      capability: other,
      id: 'second',
      execution,
      setup: () => ({ echo: (input) => input }),
    });
    expect(registry.reserve({ services: [independent] })[0]?.status).toBe('reserved');
  });

  it('rejects unknown custom kinds before reserving any preceding service', () => {
    expect.assertions(2);
    const registry = createAdmissionRegistry({ providerId: 'server' });
    const kind = defineContributionKind({ id: 'test.custom', schema: z.string() });
    const plugin = definePlugin({
      id: 'custom',
      extensions: [
        defineExtension({ descriptor: kind, id: 'extension', execution, payload: 'value' }),
      ],
    });
    expect(() => registry.reserve({ services: [service('candidate')], plugins: [plugin] })).toThrow(
      'Unknown contribution kind',
    );
    expect(registry.reserve({ services: [service('candidate')] })[0]?.status).toBe('reserved');
  });

  it('rejects duplicate contribution identity even in relaxed mode', () => {
    expect.assertions(1);
    const registry = createAdmissionRegistry({ providerId: 'server', strict: false });
    expect(() =>
      registry.reserve({
        plugins: [definePlugin({ id: 'plugin', services: [service('same'), service('same', 2)] })],
      }),
    ).toThrow('Duplicate contribution');
  });
});
