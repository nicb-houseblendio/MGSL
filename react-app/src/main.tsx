/**
 * React Suitelet entry (aligned with CFA revenue_service pattern).
 * Mounts to <div id="react-root"> when DOM is ready; shows in-DOM error on failure.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const CONTAINER_ID = 'react-root';

function init() {
  const rootElement = document.getElementById(CONTAINER_ID);
  if (!rootElement) {
    console.error('[Trader Screen] React root not found. Suitelet must include <div id="react-root"></div>');
    return;
  }
  try {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    rootElement.innerHTML = `<div style="padding: 20px; color: #b22222; font-family: sans-serif;">
      <h2>Trader Screen — Load Error</h2>
      <p>${msg}</p>
      <pre style="font-size: 11px; overflow: auto;">${error instanceof Error ? error.stack : ''}</pre>
    </div>`;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
