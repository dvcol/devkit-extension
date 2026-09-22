import { Logger } from '~/services/logger.service';
import defineComponent from '~/web/define-component';

function resizeContainer() {
  const root = document?.getElementById('app-popup');

  if (!root) return;
  root.style.width = `${window.innerWidth}px`;
  root.style.height = `${window.innerHeight}px`;
}

defineComponent({ baseUrl: import.meta.env.VITE_BASE, view: { popup: true, web: import.meta.env.VITE_WEB ?? false } })
  .then(() => {
    Logger.info('Web Component defined');
    setTimeout(resizeContainer);
  })
  .catch(err => Logger.error('Failed to define component', err));
