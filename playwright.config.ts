import { defineConfig } from "@playwright/test";

if (!process.env.QR005_BASE_URL || !process.env.QR005_SUPABASE_URL || !process.env.QR005_RESULTS_DIR) {
  throw new Error("QR-005 Playwright must be launched by the disposable local E2E runner.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI ? "line" : "list",
  outputDir: process.env.QR005_RESULTS_DIR,
  use: {
    baseURL: process.env.QR005_BASE_URL,
    browserName: "chromium",
    headless: true,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    screenshot: "off",
    trace: "off",
    video: "off",
    permissions: ["camera"],
    launchOptions: {
      executablePath: process.env.QR004_CHROME_BIN || undefined,
      args: [
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--no-first-run",
        "--no-default-browser-check",
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE ::1",
        ...(process.env.QR004_CHROME_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
      ],
    },
  },
});
