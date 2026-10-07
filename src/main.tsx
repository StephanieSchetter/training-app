import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { getState, initStore, update } from './store';
import { initSync } from './sync';
import './styles.css';

// Keeps a copy of the app on the phone so it opens with no signal, and updates itself quietly.
registerSW({ immediate: true });

// Development only: lets the scripted tests set up situations (e.g. a low readiness score) directly.
if (import.meta.env.DEV) (window as unknown as { __dev: unknown }).__dev = { update, getState };

initStore().then(initSync).then(() => createRoot(document.getElementById('root')!).render(<App />));
