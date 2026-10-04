import { defineConfig, devices } from '@playwright/test';

/**
 * Accessibility specs (npm run test:a11y): axe and keyboard checks against the
 * dev server on its own port, so a dev server already running elsewhere cannot
 * stand in for the code under test.
 *
 * The server gets a dummy environment with every service credential blank, and
 * the specs mock every network call in the browser (e2e/network.ts) and fail
 * on any request to another host. A run never spends on a model, writes to
 * Redis or pings Telegram.
 */
const PORT = 4392;

export const BASE_URL = `http://localhost:${PORT}`;

// Blank, not unset: an empty value still overrides one inherited from the shell.
const BLANK_SERVICE_ENV = Object.fromEntries([
  'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'VOYAGE_API_KEY',
  'UPSTASH_VECTOR_REST_URL', 'UPSTASH_VECTOR_REST_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
  'PROD_UPSTASH_REDIS_REST_URL', 'PROD_UPSTASH_REDIS_REST_TOKEN',
  'TELEGRAM_BOT_TOKEN', 'TELEGRAM_OWNER_ID', 'TELEGRAM_WEBHOOK_SECRET',
  'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REFRESH_TOKEN',
].map(key => [key, '']));

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.a11y.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    permissions: ['microphone'],
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  },
  webServer: {
    // Astro 7 detaches `astro dev` when it thinks an agent is running it, which
    // Playwright reads as the server exiting; --ignore-lock keeps it attached.
    command: `npx astro dev --port ${PORT} --ignore-lock`,
    url: `${BASE_URL}/home`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { ...BLANK_SERVICE_ENV, CONTENT_SOURCE: 'scaffold' },
  },
});
