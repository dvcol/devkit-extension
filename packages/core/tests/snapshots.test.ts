import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  defineActionContract,
  defineAction,
  defineCapability,
  defineExtension,
  definePlugin,
  defineService,
} from '../src/index.js';
import type { TargetRequirement } from '../src/index.js';

const setup = () => ({ echo: (value: string) => value });
const handler = () => 'result';

function mutableDeclarations() {
  const operation = { input: z.string(), output: z.string(), target: 'none' as TargetRequirement };
  const capability = {
    kind: 'capability' as const,
    id: 'example.text',
    version: 1,
    operations: { echo: operation },
  };
  const contract = { kind: 'action-contract' as const, id: 'example.echo', version: 1, operation };
  const execution = { id: 'example.server' };
  return { operation, capability, contract, execution };
}

describe('declaration ownership', () => {
  it('snapshots capability and action operation envelopes while retaining schema identity', () => {
    expect.assertions(10);
    const source = mutableDeclarations();
    const input = source.operation.input;
    const output = source.operation.output;
    const capability = defineCapability({
      id: source.capability.id,
      version: 1,
      operations: source.capability.operations,
    });
    const action = defineActionContract({
      id: source.contract.id,
      version: 1,
      operation: source.operation,
    });

    source.operation.target = 'required';
    source.operation.input = z.string().min(10);
    source.operation.output = z.string().min(10);
    source.capability.operations.echo = source.operation;

    expect(capability.operations.echo.target).toBe('none');
    expect(action.operation.target).toBe('none');
    expect(capability.operations.echo.input).toBe(input);
    expect(capability.operations.echo.output).toBe(output);
    expect(action.operation.input).toBe(input);
    expect(action.operation.output).toBe(output);
    expect(Object.isFrozen(capability.operations.echo)).toBe(true);
    expect(Object.isFrozen(action.operation)).toBe(true);
    expect(Object.isFrozen(source.operation)).toBe(false);
    expect(Object.isFrozen(source.capability.operations)).toBe(false);
  });

  it('snapshots service and action contribution identities and requirements', () => {
    expect.assertions(12);
    const source = mutableDeclarations();
    const requires = { text: source.capability };
    const service = defineService({
      capability: source.capability,
      id: 'example.service',
      execution: source.execution,
      requires,
      setup,
    });
    const action = defineAction({
      contract: source.contract,
      id: 'example.action',
      execution: source.execution,
      requires,
      handler,
    });

    source.capability.id = 'mutated';
    source.capability.version = 2;
    source.contract.id = 'mutated';
    source.contract.version = 2;
    source.execution.id = 'mutated';
    source.operation.target = 'required';
    requires.text = { ...source.capability, id: 'replacement' };

    expect(service.capability.id).toBe('example.text');
    expect(service.capability.version).toBe(1);
    expect(action.contract.id).toBe('example.echo');
    expect(action.contract.version).toBe(1);
    expect(service.requires.text.id).toBe('example.text');
    expect(action.requires.text.id).toBe('example.text');
    expect(service.execution.id).toBe('example.server');
    expect(action.execution.id).toBe('example.server');
    expect(service.capability.operations.echo.target).toBe('none');
    expect(action.contract.operation.target).toBe('none');
    expect(service).toHaveProperty('setup', setup);
    expect(action).toHaveProperty('handler', handler);
  });

  it('snapshots structural plugin services and actions before caller mutation', () => {
    expect.assertions(10);
    const source = mutableDeclarations();
    const service = {
      kind: 'service' as const,
      id: 'example.service',
      execution: source.execution,
      capability: source.capability,
      requires: { text: source.capability },
      setup: () => ({ echo: (value: string) => value }),
    };
    const action = {
      kind: 'action' as const,
      id: 'example.action',
      execution: source.execution,
      contract: source.contract,
      requires: { text: source.capability },
      handler: () => 'result',
    };
    const input = { id: 'example.plugin', services: [service], actions: [action] };
    const plugin = definePlugin(input);

    input.id = 'mutated';
    service.id = 'mutated';
    action.id = 'mutated';
    source.capability.version = 2;
    source.contract.version = 2;
    source.execution.id = 'mutated';
    source.operation.target = 'required';
    service.requires.text = { ...source.capability, id: 'replacement' };
    input.services.pop();

    expect(plugin.id).toBe('example.plugin');
    expect(plugin.services).toHaveLength(1);
    expect(plugin.services[0]?.id).toBe('example.service');
    expect(plugin.actions[0]?.id).toBe('example.action');
    expect(plugin.services[0]?.capability.version).toBe(1);
    expect(plugin.actions[0]?.contract.version).toBe(1);
    expect(plugin.services[0]?.requires.text.id).toBe('example.text');
    expect(plugin.actions[0]?.execution.id).toBe('example.server');
    expect(plugin.services[0]?.capability.operations.echo.target).toBe('none');
    expect(Object.isFrozen(service)).toBe(false);
  });

  it('snapshots custom kind identity without freezing or replacing the schema or payload', () => {
    expect.assertions(8);
    const schema = z.object({ message: z.string() });
    const descriptor = { id: 'example.custom', schema };
    const execution = { id: 'example.server' };
    const payload = { message: 'original' };
    const extension = defineExtension({
      descriptor: descriptor,
      id: 'example.extension',
      execution,
      payload,
    });
    const structural = {
      kind: 'extension' as const,
      id: 'example.structural',
      execution,
      descriptor,
      payload,
    };
    const plugin = definePlugin({ id: 'example.plugin', extensions: [structural] });

    descriptor.id = 'mutated';
    descriptor.schema = z.object({ message: z.string().min(10) });
    execution.id = 'mutated';
    structural.id = 'mutated';
    payload.message = 'still author owned';

    expect(extension.descriptor.id).toBe('example.custom');
    expect(extension.descriptor.schema).toBe(schema);
    expect(extension.execution.id).toBe('example.server');
    expect(plugin.extensions[0]?.id).toBe('example.structural');
    expect(plugin.extensions[0]?.descriptor.id).toBe('example.custom');
    expect(plugin.extensions[0]?.descriptor.schema).toBe(schema);
    expect(plugin.extensions[0]?.payload).toBe(payload);
    expect(extension.payload.message).toBe('still author owned');
  });

  it('copies domain contribution envelopes while leaving domain-owned values intact', () => {
    expect.assertions(7);
    const execution = { id: 'example.server' };
    const content = { title: 'domain owned' };
    const view = { kind: 'view' as const, id: 'example.view', execution, content };
    const transform = { kind: 'transform' as const, id: 'example.transform', execution, content };
    const script = { kind: 'script' as const, id: 'example.script', execution, content };
    const plugin = definePlugin({
      id: 'example.plugin',
      views: [view],
      transforms: [transform],
      scripts: [script],
    });

    view.id = 'mutated';
    transform.id = 'mutated';
    script.id = 'mutated';
    execution.id = 'mutated';

    expect(plugin.views[0]?.id).toBe('example.view');
    expect(plugin.transforms[0]?.id).toBe('example.transform');
    expect(plugin.scripts[0]?.id).toBe('example.script');
    expect(plugin.views[0]?.execution.id).toBe('example.server');
    expect(plugin.transforms[0]?.execution.id).toBe('example.server');
    expect(plugin.scripts[0]?.execution.id).toBe('example.server');
    expect(plugin.views[0]?.content).toBe(content);
  });
});
