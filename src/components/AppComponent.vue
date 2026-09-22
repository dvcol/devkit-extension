<script setup lang="ts">
import { RouterView } from 'vue-router';

import PageLoading from '~/components/common/loading/PageLoading.vue';
</script>

<template>
  <RouterView v-slot="{ Component }">
    <header>
      <nav />
    </header>
    <main>
      <Transition name="scale" mode="out-in">
        <KeepAlive>
          <component :is="Component ?? PageLoading" />
        </KeepAlive>
      </Transition>
    </main>
    <footer />
  </RouterView>
</template>

<style lang="scss" scoped>
@use '~/styles/mixin' as mixin;
@use '~/styles/layout' as layout;
@use '~/styles/z-index' as layers;
@use '~/styles/transition' as transition;
@include transition.scale;

header {
  position: absolute;
  top: 0;
  z-index: layers.$layer-ui;
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 100%;
  min-height: layout.$header-navbar-height;

  > :first-child {
    @include mixin.hover-background;
  }

  &.open > :first-child {
    background: var(--bg-gradient-60-90);
    // stylelint-disable-next-line property-no-vendor-prefix -- necessary for safari
    -webkit-backdrop-filter: blur(var(--bg-blur-20));
    backdrop-filter: blur(var(--bg-blur-20));
  }
}

main {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: layout.$main-content-height;
  margin-top: layout.$safe-navbar-height;

  &.full-height {
    min-height: var(--full-height);
    margin-top: 0;

    :deep(.loading-container) {
      padding-top: layout.$safe-navbar-height;
    }
  }
}

footer {
  position: fixed;
  bottom: 0;
  z-index: layers.$layer-ui;
  width: 100%;
}
</style>
