import type { AsyncComponentOptions, Component } from 'vue';

import { defineAsyncComponent } from 'vue';

export function lazyComponent<T extends Component>(loader: AsyncComponentOptions<T>['loader'], options: Omit<AsyncComponentOptions, 'loader'> = {}): T {
  return defineAsyncComponent<T>({ loader, ...options });
}

export default lazyComponent;
