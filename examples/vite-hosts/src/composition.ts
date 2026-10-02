import { definePlugin } from '@devkit/core';
import { counterCapability, increaseCounterAction } from '@devkit/example-contribution';
import { counterActionsPlugin, counterService } from '@devkit/example-server-contexts';
import type { ServerComposition } from '@devkit/server';
import { counterViewPlugin } from './counter-view.js';
import { createHtmlBootstrapFeature } from './html-bootstrap.js';
import { createHtmlTransformFeatures } from './html-transforms.js';

/** One native configuration and portable composition for each actual Vite provider generation. */
export function counterComposition(host: 'devframe' | 'devtools') {
  const bootstrap = createHtmlBootstrapFeature();
  const transforms = createHtmlTransformFeatures();
  const composition: ServerComposition = {
    providerId: `example.${host}-vite`,
    services: [counterService],
    plugins: [
      counterActionsPlugin,
      counterViewPlugin,
      definePlugin({ id: 'example.bootstrap', scripts: [bootstrap.script] }),
      definePlugin({ id: 'example.html-first', transforms: [transforms.first.transform] }),
      definePlugin({ id: 'example.html-second', transforms: [transforms.second.transform] }),
    ],
    expose: { actions: [increaseCounterAction], capabilities: [counterCapability] },
  };
  return {
    composition,
    plugins: [transforms.second.plugin, transforms.first.plugin, bootstrap.plugin],
  };
}
