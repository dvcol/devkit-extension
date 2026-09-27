import {
  structuredCloneDeserialize,
  structuredCloneSerialize,
} from 'devframe/utils/structured-clone';
import { describe, expect, it } from 'vitest';

describe('upstream serialization compatibility', () => {
  it('preserves structured values through a JSON envelope', () => {
    expect.assertions(3);
    const value = {
      date: new Date('2026-09-27T00:00:00Z'),
      map: new Map([['count', 1]]),
      set: new Set(['first', 'second']),
      integer: 123n,
      optional: undefined,
      items: [undefined],
      cycle: new Map<string, unknown>(),
    };
    value.cycle.set('self', value);
    const records = jsonEnvelope(structuredCloneSerialize(value));
    const restored = structuredCloneDeserialize<typeof value>(records);
    expect(restored).toEqual(value);
    expect(restored.cycle.get('self')).toBe(restored);
    expect(Object.hasOwn(restored, 'optional')).toBe(true);
  });

  it('preserves root absence and rejects executable values', () => {
    expect.assertions(2);
    const absent = { value: undefined };
    expect(
      structuredCloneDeserialize(jsonEnvelope(structuredCloneSerialize(absent.value))),
    ).toBeUndefined();
    expect(() => structuredCloneSerialize({ handler() {} })).toThrow(/unable to serialize/u);
  });
});

function jsonEnvelope(records: unknown[]): unknown[] {
  const parsed: unknown = JSON.parse(JSON.stringify(records));
  if (!Array.isArray(parsed)) throw new TypeError('Expected serialized records');
  return parsed;
}
