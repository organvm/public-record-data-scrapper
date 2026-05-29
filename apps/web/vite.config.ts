import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import { defineConfig, PluginOption } from 'vite'

import sparkPlugin from '@github/spark/spark-vite-plugin'
import createIconImportProxy from '@github/spark/vitePhosphorIconProxyPlugin'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const appRoot = dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  root: appRoot,
  plugins: [
    react(),
    tailwindcss(),
    // DO NOT REMOVE
    createIconImportProxy() as PluginOption,
    sparkPlugin({ port: 5173 }) as PluginOption
  ],
  resolve: {
    alias: {
      '@': resolve(appRoot, 'src')
    }
  },
  build: {
    outDir: resolve(appRoot, '../../dist'),
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    // Proxy API calls to the Express server (default :3000) so the SPA's
    // relative `/api` base resolves to the backend in local dev instead of
    // hitting the Vite static server (which would return index.html as HTML).
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true
      },
      // Real free public-data sources, proxied to avoid browser CORS in dev.
      // In production, point the app at a deployed proxy or the direct API.
      '/ext/usaspending': {
        target: 'https://api.usaspending.gov',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/ext\/usaspending/, '')
      },
      // NY Dept. of State open data (Socrata) — real state business registrations.
      '/ext/nyopendata': {
        target: 'https://data.ny.gov',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/ext\/nyopendata/, '')
      },
      '/ext/sec': {
        target: 'https://www.sec.gov',
        changeOrigin: true,
        secure: true,
        headers: { 'User-Agent': 'UCC-MCA-Intelligence research@example.com' },
        rewrite: (p) => p.replace(/^\/ext\/sec/, '')
      }
    },
    fs: {
      allow: [appRoot, resolve(appRoot, '../../packages'), resolve(appRoot, '../../node_modules')]
    }
  }
})
