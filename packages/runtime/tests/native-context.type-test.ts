import { defineNativeContext } from '@devkit/core';
import type { NativeContextAccess } from '@devkit/core';
import type {
  LocalInvocationContext,
  LocalInvocationRequest,
  ProviderLifecycleOptions,
} from '@devkit/runtime';

interface CounterContext {
  read(): number;
}

const counterContext = defineNativeContext<CounterContext>({ id: 'example.native-counter' });

export function nativeContextTypes(
  options: ProviderLifecycleOptions,
  context: LocalInvocationContext,
  request: LocalInvocationRequest,
): void {
  options.native satisfies NativeContextAccess;
  options.native.get(counterContext) satisfies CounterContext | undefined;
  options.native.get(counterContext)?.read() satisfies number | undefined;
  context.native.get(counterContext) satisfies CounterContext | undefined;
  context.native.get(counterContext)?.read() satisfies number | undefined;
  request.context.native.get(counterContext) satisfies CounterContext | undefined;
  request.context.native.get(counterContext)?.read() satisfies number | undefined;
  // @ts-expect-error Provider lookup retains the imported native descriptor's value type.
  options.native.get(counterContext) satisfies string | undefined;
  // @ts-expect-error Native contexts are optional even when the descriptor is known.
  options.native.get(counterContext) satisfies CounterContext;
  // @ts-expect-error A local invocation preserves the same native context type.
  context.native.get(counterContext) satisfies string | undefined;
  // @ts-expect-error An invocation request does not erase its native lookup type.
  request.context.native.get(counterContext) satisfies string | undefined;
}
