import { boot } from './main';

try { boot(); }
catch (error) {
  document.body.dataset.error = 'true';
  document.querySelector<HTMLElement>('#status')!.textContent = 'The island could not open. WebGL 2 and hardware acceleration are required.';
  console.error(error);
}
