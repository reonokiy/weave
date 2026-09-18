import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests/integrated', outputDir: 'test-results/integrated', workers: 1,
  timeout: 60000, expect: { timeout: 10000 },
  reporter: [['list'], ['json', { outputFile: `artifacts/integrated/${process.env.GTS_TEST_REGISTRATION === 'true' ? 'registration' : process.env.GTS_DOCKER_IMAGE ? 'container' : 'results'}.json` }]],
  use: { baseURL: 'http://127.0.0.1:8686', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } }, { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }],
  webServer: [
    { command: process.env.GTS_DOCKER_IMAGE ? 'node scripts/gts-container.mjs' : 'GTS_TEST_ADMIN=alice GTS_WEB="$PWD/artifacts/gts-web" node scripts/gts-instance.mjs', url: 'http://127.0.0.1:8687', reuseExistingServer: false, timeout: 120000, gracefulShutdown: { signal: 'SIGTERM', timeout: 45000 } },
  ],
})
