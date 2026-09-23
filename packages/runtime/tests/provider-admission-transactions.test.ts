import { defineCapability, definePlugin, defineService } from '@devkit/core';
import { describe, expect, it } from 'vitest';

import { createAdmissionRegistry } from '../src/admission.js';
import type { Admission } from '../src/admission.js';
import { capability, execution, operation } from './provider-fixtures.js';

const other = defineCapability({
  id: 'example.other',
  version: 1,
  operations: { echo: operation },
});
const independent = defineCapability({
  id: 'example.independent',
  version: 1,
  operations: { echo: operation },
});
const setup = () => ({ echo: (value: string) => value });

function reserved(admission: Admission | undefined) {
  if (admission?.status !== 'reserved') throw new Error('Expected a reservation');
  return admission.reservation;
}

describe('replacement reservation graph', () => {
  it('rejects an incoming batch that would break the retained graph if replacement aborts', () => {
    expect.assertions(3);
    const registry = createAdmissionRegistry({ providerId: 'example.provider' });
    const old = defineService(capability, { id: 'old', execution, requires: { other }, setup });
    const current = reserved(registry.reserve({ services: [old] })[0]);
    const transaction = registry.beginReplacement(
      { services: [defineService(capability, { id: 'new', execution, setup })] },
      current,
    );
    const cyclicOnRollback = defineService(other, {
      id: 'other',
      execution,
      requires: { source: capability },
      setup,
    });
    expect(() => registry.reserve({ services: [cyclicOnRollback] })).toThrow('cycle');
    transaction.abort();
    expect(() => registry.reserve({ services: [old] })).toThrow('already registered');
    expect(
      registry.reserve({ services: [defineService(other, { id: 'other', execution, setup })] })[0]
        ?.status,
    ).toBe('reserved');
  });

  it('rejects incoming cycles in the successor graph while permitting disjoint admission', () => {
    expect.assertions(4);
    const registry = createAdmissionRegistry({ providerId: 'example.provider' });
    const current = reserved(
      registry.reserve({
        services: [defineService(capability, { id: 'old', execution, setup })],
      })[0],
    );
    const replacement = defineService(capability, {
      id: 'new',
      execution,
      requires: { other },
      setup,
    });
    const transaction = registry.beginReplacement({ services: [replacement] }, current);
    const cyclicAfterCommit = defineService(other, {
      id: 'other',
      execution,
      requires: { source: capability },
      setup,
    });
    expect(() => registry.reserve({ services: [cyclicAfterCommit] })).toThrow('cycle');
    expect(
      registry.reserve({
        services: [defineService(independent, { id: 'independent', execution, setup })],
      })[0]?.status,
    ).toBe('reserved');
    registry.release(current);
    expect(() => registry.reserve({ services: [replacement] })).toThrow('already registered');
    expect(transaction.commit()[0]?.status).toBe('reserved');
  });

  it('allows an atomic plugin dependency reversal without combining incompatible graph generations', () => {
    expect.assertions(3);
    const registry = createAdmissionRegistry({ providerId: 'example.provider' });
    const first = definePlugin({
      id: 'plugin',
      services: [
        defineService(capability, { id: 'first', execution, requires: { other }, setup }),
        defineService(other, { id: 'other', execution, setup }),
      ],
    });
    const current = reserved(registry.reserve({ plugins: [first] })[0]);
    const second = definePlugin({
      id: 'plugin',
      services: [
        defineService(capability, { id: 'first', execution, setup }),
        defineService(other, { id: 'other', execution, requires: { source: capability }, setup }),
      ],
    });
    const transaction = registry.beginReplacement({ plugins: [second] }, current);
    expect(
      registry.reserve({
        services: [defineService(independent, { id: 'independent', execution, setup })],
      })[0]?.status,
    ).toBe('reserved');
    expect(transaction.commit()[0]?.status).toBe('reserved');
    expect(() => registry.reserve({ plugins: [second] })).toThrow('already registered');
  });
});
