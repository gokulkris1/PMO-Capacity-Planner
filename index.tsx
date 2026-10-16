import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './index.css';
// TEMPORARY: v1.1 variable names mapped onto 2.0 tokens for screens not yet migrated (see the file header).
import './styles/legacy-aliases.css';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

// Light theme in 2.0 (dark tokens exist; the toggle is XT-01, Could).
document.documentElement.dataset.theme = 'light';

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
