import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import './design/fonts';
import './design/tokens.css';
import { App } from './app/App';
import { AppProviders } from './app/providers';
import { routes } from './app/router';

const router = createBrowserRouter(routes);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <App router={router} />
    </AppProviders>
  </StrictMode>,
);
