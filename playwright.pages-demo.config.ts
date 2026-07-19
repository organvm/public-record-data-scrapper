import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:4173/public-record-data-scrapper/'

export default defineConfig({
  testDir: './tests/e2e-pages-demo',
  outputDir: './dist/playwright-pages-demo-results',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    channel: 'chrome',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome']
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command:
      'npm --workspace apps/web run preview -- --host 127.0.0.1 --port 4173 --base=/public-record-data-scrapper/',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000
  },
  timeout: 30_000,
  expect: { timeout: 5_000 }
})
