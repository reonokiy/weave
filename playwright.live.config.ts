import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  outputDir: 'test-results/live',
  testDir: './tests/live', workers: 1, timeout: 60000,
  expect: { timeout: 10000 },
  use: { baseURL: 'http://127.0.0.1:4188', actionTimeout: 10000, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  reporter: [['list'], ['json', { outputFile: 'artifacts/live/results.json' }]],
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: [
    { command: 'node scripts/gts-instance.mjs', url: 'http://127.0.0.1:8687', timeout: 120000, reuseExistingServer: false },
    { command: 'pnpm dev --port 4188 --strictPort', url: 'http://127.0.0.1:4188', reuseExistingServer: false },
  ],
})
