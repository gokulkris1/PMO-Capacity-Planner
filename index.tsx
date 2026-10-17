import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './index.css';
import { DataProvider } from './state';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

// After a new deploy, a tab opened on the previous one asks for hashed page chunks that no longer exist. Reload
// once to pick up the new build (guarded, so a genuinely broken chunk cannot cause a reload loop).
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'pcp-chunk-reload';
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

// Light theme in 2.0 (dark tokens exist; the toggle is XT-01, Could).
document.documentElement.dataset.theme = 'light';

createRoot(rootElement).render(
  <StrictMode>
    <DataProvider forceDemo={import.meta.env.MODE === 'demo'}>
      <App />
    </DataProvider>
  </StrictMode>,
);
