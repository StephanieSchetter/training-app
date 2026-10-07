import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { initStore } from './store';
import { initSync } from './sync';
import './styles.css';

// Keeps a copy of the app on the phone so it opens with no signal, and updates itself quietly.
registerSW({ immediate: true });

initStore().then(initSync).then(() => createRoot(document.getElementById('root')!).render(<App />));
