<script setup lang="ts">
import { lazyComponent } from '~/utils/lazy.utils';

const AppComponent = lazyComponent(() => import('~/components/AppComponent.vue'));
</script>

<template>
  <div id="app-container-root">
    <AppComponent />
  </div>
</template>

<style lang="scss">
@use '~/styles/base';

:host {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  height: var(--full-height);
  overflow: auto;
  color: var(--color-text);
  font-weight: normal;
  font-family:
    Inter,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    Oxygen,
    Ubuntu,
    Cantarell,
    'Fira Sans',
    'Droid Sans',
    'Helvetica Neue',
    sans-serif;
  transition:
    color 0.5s,
    background-color 0.5s;
  text-rendering: optimizelegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  scrollbar-width: thin;
}
</style>
