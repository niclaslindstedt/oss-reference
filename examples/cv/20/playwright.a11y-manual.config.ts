import { defineConfig, devices } from "@playwright/test";

// Manual-only WCAG checks that need a real browser but are too slow,
// noisy, or judgement-sensitive for the always-on `a11y` workflow.
// Cover SC 1.4.4 (Resize Text 200%), SC 1.4.10 (Reflow @ 320 CSS px),
// and SC 2.4.11 (Focus Not Obscured Minimum).
//
// Run via `make test-a11y-manual` against a built site.

const PORT = Number(process.env.PLAYWRIGHT_A11Y_MANUAL_PORT ?? 4175);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/a11y-manual",
  testMatch: /.*\.test\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  },
});
