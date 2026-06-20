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
