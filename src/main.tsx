import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppStateProvider } from './state';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppStateProvider>
        <App />
      </AppStateProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
