import { value } from './value';
const counter = Number(sessionStorage.getItem('page-loads') ?? 0) + 1;
sessionStorage.setItem('page-loads', String(counter));
document.querySelector('#result')!.textContent = value;
if (import.meta.hot) {
  import.meta.hot.accept('./value', (updatedModule) => {
    document.querySelector('#result')!.textContent = updatedModule?.value ?? 'failed';
  });
}
