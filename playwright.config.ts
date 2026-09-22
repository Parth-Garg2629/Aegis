import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  reporter: 'list',
  use: {
    channel: 'chrome',
    headless: true,
  },
  projects: [
    {
      name: 'chrome',
      use: {
        channel: 'chrome',
        headless: true,
      },
    },
  ],
});
