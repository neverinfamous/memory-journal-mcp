import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
    testDir: './tests/e2e',
    outputDir: '.test-output/playwright',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: 'list',
    use: {
        baseURL: 'http://localhost:3100',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'api',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command:
            'node dist/cli.js --transport http --port 3100 --db ./.test-output/e2e/test-e2e.db --backup-interval 1 --keep-backups 3 --vacuum-interval 2 --rebuild-index-interval 2',
        env: {
            ...process.env,
            // Prevent 429s during E2E runs with many client connections
            MCP_RATE_LIMIT_MAX: '10000',
        },
        url: 'http://localhost:3100/health',
        reuseExistingServer: !process.env.CI,
        timeout: 15000,
        stdout: 'pipe',
        stderr: 'pipe',
    },
})
