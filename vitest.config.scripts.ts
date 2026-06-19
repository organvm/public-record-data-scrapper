import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'scripts',
    globals: true,
    environment: 'node',
    include: ['scripts/scrapers/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'build'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['scripts/scrapers/**/*.ts'],
      exclude: ['scripts/scrapers/**/*.test.ts', 'scripts/scrapers/test-scrapers.ts']
    },
    pool: 'forks',
    testTimeout: 10000,
    hookTimeout: 10000
  }
})
