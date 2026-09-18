import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  outputDir: 'test-results/browser',
  testDir: './tests/browser',
  timeout: 30000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4187', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: { command: 'pnpm dev --port 4187 --strictPort', url: 'http://127.0.0.1:4187', reuseExistingServer: true },
})
