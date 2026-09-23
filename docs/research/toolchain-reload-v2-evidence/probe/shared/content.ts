import { callProbe } from './api';
import { version } from './content-version';
export function startContent(): () => void {
  let invocationCount = 0;
  const contentBoot = Date.now();
  async function report(action = 'fixture.read'): Promise<void> {
    const reply = await callProbe(action);
    const observation = { ...reply, contentVersion: version, contentBoot, invocationCount, pageTimeOrigin: performance.timeOrigin };
    document.documentElement.dataset.probe = JSON.stringify(observation);
    await fetch('/extension-report', { method: 'POST', body: JSON.stringify(observation) });
  }
  function increment(): void {
    invocationCount += 1;
    void report('fixture.increment');
  }
  function failAction(): void { void report('fixture.fail'); }
  function openPage(): void { void report('fixture.open'); }
  function refresh(): void { void report(); }
  document.addEventListener('probe:increment', increment);
  document.addEventListener('probe:read', refresh);
  document.addEventListener('probe:open', openPage);
  document.addEventListener('probe:fail', failAction);
  const interval = setInterval(refresh, 500);
  refresh();
  return () => {
    clearInterval(interval);
    document.removeEventListener('probe:increment', increment);
    document.removeEventListener('probe:read', refresh);
    document.removeEventListener('probe:open', openPage);
    document.removeEventListener('probe:fail', failAction);
  };
}
