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
  // Base public path. Defaults to '/' for root deployments (Vercel/Cloudflare
  // Pages). The GitHub Pages workflow sets VITE_BASE=/public-record-data-scrapper/
  // so built asset URLs resolve under the project subpath.
  base: process.env.VITE_BASE || '/',
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
    fs: {
      allow: [
        appRoot,
        resolve(appRoot, '../../packages'),
        resolve(appRoot, '../../node_modules')
      ]
    }
  }
})
