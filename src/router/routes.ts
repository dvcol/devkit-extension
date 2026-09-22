import type { RouteComponent, RouteRecordRaw } from 'vue-router';

export enum Route {
  Home = 'home',
  Hello = 'hello',
  Goodbye = 'goodbye',
}

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: Route.Home,
    redirect: { name: 'hello' },
  },
  {
    path: `/${Route.Hello}`,
    name: Route.Hello,
    component: async () => import('~/components/views/hello/HelloComponent.vue') as Promise<RouteComponent>,
  },
  {
    path: `/${Route.Goodbye}`,
    name: Route.Goodbye,
    component: async () => import('~/components/views/goodbye/GoodbyeComponent.vue') as Promise<RouteComponent>,
  },
];
