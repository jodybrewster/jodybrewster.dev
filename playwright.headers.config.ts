import { defineConfig, devices } from '@playwright/test';

/**
 * The security headers in a browser (npm run test:headers): the built site,
 * served with the headers it ships with (scripts/serve-output.mjs reads
 * .vercel/output/config.json), loaded in Chromium, WebKit and Firefox, with
 * every page, the client router, search and a mocked voice session checked
 * for policy violations. Build first (`npm run build`).
 */
export const HEADERS_PORT = 4394;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.headers.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${HEADERS_PORT}` },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], permissions: ['microphone'], launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], launchOptions: { firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true } } } },
  ],
  webServer: {
    command: `PORT=${HEADERS_PORT} node scripts/serve-output.mjs`,
    url: `http://localhost:${HEADERS_PORT}/home`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
