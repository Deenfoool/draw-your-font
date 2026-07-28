import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/cross-browser',
  timeout: 120000,
  retries: 1,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node server.mjs --port 4173 --host 127.0.0.1 --data-dir .tmp-playwright-public',
    url: 'http://127.0.0.1:4173/api/health',
    reuseExistingServer: false,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
