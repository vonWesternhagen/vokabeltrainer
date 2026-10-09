const path = require('node:path');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(__dirname, '.cache/ms-playwright');
const { defineConfig } = require('@playwright/test');
const launchOptions = browserName => browserName === 'chromium' && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {};

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  timeout: 30000,
  expect: { timeout: 5000 },
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:8765',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'python3 -m http.server 8765 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8765',
    reuseExistingServer: false,
    timeout: 10000,
    stdout: 'ignore',
    stderr: 'ignore',
  },
  projects: ['chromium', 'webkit'].flatMap(browserName => [
    { name: browserName, testIgnore: '**/tablet.spec.js', use: { browserName, launchOptions: launchOptions(browserName) } },
    ...[
      ['portrait', { width: 810, height: 1080 }],
      ['landscape', { width: 1080, height: 810 }],
    ].map(([orientation, viewport]) => ({
      name: `${browserName}-ipad-${orientation}`,
      testMatch: '**/tablet.spec.js',
      use: { browserName, launchOptions: launchOptions(browserName), viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    })),
  ]),
});
