import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { browserName: "chromium", headless: true },
  webServer: {
    command: "node tests/server.js",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
