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
            // Elevate rate limit boundary for test runner concurrency (simulating realistic clustered traffic)
            MCP_RATE_LIMIT_MAX: '1000',
            // Enable team DB so team tools get functional E2E coverage
            TEAM_DB_PATH: './.test-output/e2e/test-e2e-team.db',
            ALLOWED_IO_ROOTS: process.cwd(),
        },
        url: 'http://localhost:3100/health',
        reuseExistingServer: !process.env.CI,
        timeout: 15000,
        stdout: 'pipe',
        stderr: 'pipe',
    },
})
