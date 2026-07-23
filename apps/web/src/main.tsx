import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from 'react-error-boundary'

import App from './App.tsx'
import { ErrorFallback } from './ErrorFallback.tsx'
import { ThemeProvider } from './components/ThemeProvider.tsx'

import './main.css'
import './styles/theme.css'
import './index.css'

// Guard: on a static production deploy (GitHub Pages, Cloudflare Pages, etc.)
// the Spark runtime module fires a top-level POST to /_spark/loaded the moment
// it is imported.  That endpoint does not exist on a static host and returns
// 405, producing a console error.  Skip the import entirely when we are in a
// production build AND no explicit API base URL was configured — those two facts
// together mean there is no Spark backend, and the app already falls back to
// local-storage state management via useSparkKV.
const hasApiBase = Boolean(import.meta.env.VITE_API_BASE_URL)
if (typeof window !== 'undefined' && !(import.meta.env.PROD && !hasApiBase)) {
  import('@github/spark/spark').catch((error) => {
    console.warn(
      '[main] Unable to load Spark runtime; falling back to local storage state management.',
      error
    )
  })
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary FallbackComponent={ErrorFallback}>
    <ThemeProvider
      attribute="class"
      defaultTheme="dark-professional"
      themes={['dark-professional', 'light-clean', 'dark-green', 'current-fixed', 'hacker']}
    >
      <App />
    </ThemeProvider>
  </ErrorBoundary>
)
