import type { StandardSchemaV1 } from '@standard-schema/spec';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  defineActionContract,
  defineAction,
  defineCapability,
  defineContributionKind,
  defineExecution,
  defineExtension,
  defineNativeContext,
  defineOperation,
  definePlugin,
  defineRealm,
  defineService,
} from '../src/index.js';

const execution = defineExecution({ id: 'example.server' });
const operation = defineOperation({ input: z.string(), output: z.string(), target: 'none' });
const capability = defineCapability({
  id: 'example.text',
  version: 1,
  operations: { echo: operation },
});
const action = defineActionContract({ id: 'example.echo', version: 1, operation });
const setup = (): { echo: (value: string) => string } => ({ echo: (value) => value });

describe('portable definitions', () => {
  it('preserves contract content and leaves setup, handlers and schema validation inert', () => {
    expect.assertions(11);
    const validate = vi.fn<(value: unknown) => { readonly value: unknown }>((value) => ({ value }));
    const schema: StandardSchemaV1 = { '~standard': { version: 1, vendor: 'example', validate } };
    const localSetup = vi.fn<typeof setup>(setup);
    const handler = vi.fn<() => string>(() => 'action');
    const service = defineService({
      capability: capability,
      id: 'example.service',
      execution,
      setup: localSetup,
    });
    const contribution = defineAction({
      contract: action,
      id: 'example.handler',
      execution,
      handler,
    });
    const kind = defineContributionKind({ id: 'example.message', schema });
    const payload = { message: 'unchanged' };
    const extension = defineExtension({
      descriptor: kind,
      id: 'example.extension',
      execution,
      payload,
    });
    const plugin = definePlugin({
      id: 'example.plugin',
      services: [service],
      actions: [contribution],
      extensions: [extension],
    });

    expect(localSetup).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
    expect(service.capability).toEqual(capability);
    expect(contribution.contract).toEqual(action);
    expect(extension.descriptor).toEqual(kind);
    expect(extension.payload).toBe(payload);
    expect(service.requires).toEqual({});
    expect(contribution.requires).toEqual({});
    expect(plugin.kind).toBe('plugin');
    expect(plugin.services).toEqual([service]);
  });

  it('copies and freezes declaration collections without freezing caller data or schemas', () => {
    expect.assertions(10);
    const operations = { echo: operation };
    const mutableCapability = defineCapability({ id: 'example.mutable', version: 1, operations });
    const requires = { texts: capability };
    const service = defineService({
      capability: capability,
      id: 'example.service',
      execution,
      requires,
      setup,
    });
    const services = [service];
    const plugin = definePlugin({ id: 'example.plugin', services });
    services.pop();

    expect(plugin.services).toHaveLength(1);
    expect(plugin.services).not.toBe(services);
    expect(Object.isFrozen(plugin)).toBe(true);
    expect(Object.isFrozen(plugin.services)).toBe(true);
    expect(Object.isFrozen(service.requires)).toBe(true);
    expect(service.requires).not.toBe(requires);
    expect(mutableCapability.operations).not.toBe(operations);
    expect(Object.isFrozen(mutableCapability.operations)).toBe(true);
    expect(Object.isFrozen(operations)).toBe(false);
    expect(operation.input).toBe(operations.echo.input);
  });

  it('accepts custom realms, exact positive versions and every dedicated plugin list', () => {
    expect.assertions(8);
    const realm = defineRealm({ id: 'example.unlisted-realm' });
    const native = defineNativeContext<{ readonly name: string }>({ id: 'example.native' });
    const service = defineService({
      capability: capability,
      id: 'example.service',
      execution,
      setup,
    });
    const plugin = definePlugin({
      id: 'example.all-kinds',
      services: [service],
      actions: [
        defineAction({ contract: action, id: 'example.handler', execution, handler: () => '' }),
      ],
      views: [{ id: 'example.view', kind: 'view', execution }],
      transforms: [{ id: 'example.transform', kind: 'transform', execution }],
      scripts: [{ id: 'example.script', kind: 'script', execution }],
      extensions: [],
    });

    expect(realm.id).toBe('example.unlisted-realm');
    expect(native.id).toBe('example.native');
    expect(
      defineCapability({ id: 'example.latest', version: Number.MAX_SAFE_INTEGER, operations: {} })
        .version,
    ).toBe(Number.MAX_SAFE_INTEGER);
    expect(plugin.services[0]?.kind).toBe('service');
    expect(plugin.actions[0]?.kind).toBe('action');
    expect(plugin.views[0]?.kind).toBe('view');
    expect(plugin.transforms[0]?.kind).toBe('transform');
    expect(plugin.scripts[0]?.kind).toBe('script');
  });

  it('retains async and transforming validators for guard-only validation at invocation', () => {
    expect.assertions(3);
    const schema = z.string().transform(Number);
    const asyncSchema = z.string().refine(() => Promise.resolve(true));
    const definition = defineOperation({ input: schema, output: asyncSchema, target: 'required' });

    expect(definition.input).toBe(schema);
    expect(definition.output).toBe(asyncSchema);
    expect(definition.target).toBe('required');
  });

  it('preserves duplicate declarations for the provider admission strictness policy', () => {
    expect.assertions(3);
    const service = defineService({
      capability: capability,
      id: 'example.service',
      execution,
      setup,
    });
    const plugin = definePlugin({ id: 'example.duplicate', services: [service, service] });

    expect(plugin.services).toHaveLength(2);
    expect(plugin.services[0]).toEqual(service);
    expect(plugin.services[1]).toEqual(service);
  });
});
