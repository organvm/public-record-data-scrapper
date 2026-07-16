import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from 'react-error-boundary'

import App from './App.tsx'
import { ErrorFallback } from './ErrorFallback.tsx'
import { ThemeProvider } from './components/ThemeProvider.tsx'

import './main.css'
import './styles/theme.css'
import './index.css'

const publicDemoEnabled = Boolean(String(import.meta.env.VITE_PUBLIC_DEMO_RECEIPT_URL ?? '').trim())

// The static Pages demo is explicitly zero-write. Loading the Spark runtime
// would POST its normal `/_spark/loaded` telemetry to an endpoint that GitHub
// Pages neither owns nor serves, so retain Spark for normal app builds only.
if (typeof window !== 'undefined' && !publicDemoEnabled) {
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
