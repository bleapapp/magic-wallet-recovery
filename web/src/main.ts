import './style.css';
import { setRenderer, startDiscovery, state } from './app.js';
import { mount } from './dom.js';
import { viewApp } from './views.js';

const root = document.getElementById('app');

// The page must not run inside another site's frame (it could be overlaid to trick clicks).
if (window.top !== window.self) {
  document.body.textContent = 'For your safety, this page cannot be displayed inside another page.';
} else if (root) {
  const render = () => mount(root, ...viewApp(state));
  setRenderer(render);
  render();
  startDiscovery();
  // A signed withdrawal not submitted yet stays usable: ask before leaving or reloading the page.
  window.addEventListener('beforeunload', (event) => {
    if (state.withdrawalSigned) event.preventDefault();
  });
}
