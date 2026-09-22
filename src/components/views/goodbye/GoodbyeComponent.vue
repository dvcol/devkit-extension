<script lang="ts" setup>
import { RouterLink } from 'vue-router';

import { Route } from '~/router';
import { useI18n } from '~/utils/i18n.utils';

const i18n = useI18n('goodbye');
</script>

<template>
  <div class="text">
    <span class="title">{{ i18n('app_name', 'global') }}</span>
    <RouterLink :to="Route.Hello">
      {{ i18n('title') }}
    </RouterLink>
  </div>
</template>

<style lang="scss" scoped>
.text {
  display: flex;
  flex-direction: column;
  align-items: center;
  align-self: center;
  justify-content: center;
  width: 100%;
  height: 100%;

  .title {
    margin-bottom: 2rem;
  }

  a {
    color: white;
    text-decoration: none;
    outline: none;
  }
}
</style>
