// playwright.config.ts (ルート)
import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import dotenv from 'dotenv';

// ルートの .env.local を読み込む
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

export default defineConfig({
  testDir: 'e2e/tests',       // ← e2e配下のtestsを指す
  timeout: 60_000,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4242',
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // 必要に応じて devサーバの自動起動も可
  // webServer: { command: 'npm run dev', port: 4242, reuseExistingServer: true },
});
