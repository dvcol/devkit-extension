<script setup lang="ts">
import IconLoadingMatrix from '~/components/icons/IconLoadingMatrix.vue';
</script>

<template>
  <div class="loading-container">
    <IconLoadingMatrix class="loader" />
  </div>
</template>

<style lang="scss" scoped>
.loading-container {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  opacity: 1;
  transition: opacity 1s ease-in 0.2s;

  .loader {
    width: 3rem;
    max-width: 8dvh;
    height: 3rem;
    max-height: 8dvh;
    padding: 2rem;

    /* Adds 0.2s delay and 1s transition to loading indicator to prevent flashing */
    @starting-style {
      opacity: 0;
    }
  }
}
</style>
