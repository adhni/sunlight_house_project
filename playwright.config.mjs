import { defineConfig, devices } from "@playwright/test";

const python = process.env.PYTHON || "python";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  fullyParallel: false,
  reporter: process.env.CI ? "github" : "line",
  use: {
    baseURL: "http://127.0.0.1:5055",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `${python} app.py`,
    url: "http://127.0.0.1:5055/healthz",
    env: {
      ...process.env,
      PORT: "5055",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1200 },
      },
    },
  ],
});
