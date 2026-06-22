import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react-swc'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    // Cold CI runs spend enough CPU on concurrent jsdom workers and transforms
    // that otherwise-fast interaction tests can exceed Vitest's 5s default.
    testTimeout: 15000,
    // Pin discovery to this app's own root and source tree. Without this, a
    // root-level `vitest` invocation lets the default `**/*.{test,spec}` glob
    // escape into sibling workspaces (notably the node-environment server
    // suite), producing spurious failures. Keep the web run hermetic.
    root: __dirname,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: [resolve(__dirname, 'src/test/setup.ts')],
    exclude: [
      'node_modules/**',
      'dist/**',
      '**/tests/e2e/**' // Playwright E2E tests are run separately
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', '**/src/test/**', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}']
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
})
