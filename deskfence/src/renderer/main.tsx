import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { installBrowserShim } from './electron-shim';
import { installClickThroughHitTest } from './utils/click-through';
import { useAutomationStore } from './store/automationStore';
import { useScheduledStore } from './store/scheduledStore';

// Must run before React renders: gives browser mode a safe window.electronAPI
installBrowserShim();
installClickThroughHitTest();

// Several monitor windows share one localStorage: when another window changes rules or
// scheduled tasks, reload them here so every window (and the controller) sees the same data.
window.addEventListener('storage', (event) => {
  if (event.key === 'deskfence-rules') useAutomationStore.persist.rehydrate();
  if (event.key === 'deskfence-scheduled-tasks') useScheduledStore.persist.rehydrate();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
