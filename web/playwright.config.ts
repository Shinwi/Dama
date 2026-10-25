import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: [['list'], ['junit', { outputFile: 'test-results/junit.xml' }]],
  use: {
    baseURL: 'http://localhost:4300',
  },
  webServer: [
    {
      command: 'npx ng serve --port 4300',
      url: 'http://localhost:4300',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      // The online server, for e2e/online.spec.ts. Needs `npm install` in ../server first.
      command: 'npm --prefix ../server start',
      url: 'http://localhost:3000',
      // So e2e/online.spec.ts can claim a win without waiting 5 minutes.
      env: { CLAIM_WIN_AFTER_SECONDS: '3' },
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
  ],
  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Pixel 7',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
