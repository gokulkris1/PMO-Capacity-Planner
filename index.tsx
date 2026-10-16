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

// Light theme in 2.0 (dark tokens exist; the toggle is XT-01, Could).
document.documentElement.dataset.theme = 'light';

createRoot(rootElement).render(
  <StrictMode>
    <DataProvider forceDemo={import.meta.env.MODE === 'demo'}>
      <App />
    </DataProvider>
  </StrictMode>,
);
