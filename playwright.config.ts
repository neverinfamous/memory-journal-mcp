import { defineConfig, devices } from '@playwright/test'

const WORKERS = 1; // Using 1 worker to prevent SQLite lock contention and transport blocking

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 60000,
    outputDir: '.test-output/playwright',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: WORKERS,
    reporter: [['list'], ['json', { outputFile: '.test-output/playwright-results.json' }]],
    use: {
        trace: 'on-first-retry',
        actionTimeout: 0,
    },
    projects: [
        {
            name: 'api',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: Array.from({ length: WORKERS }).map((_, i) => {
        const port = 3100 + i;
        return {
            command:
                `node dist/cli.js --transport http --port ${port} --db ./.test-output/e2e/test-e2e-worker-${i}.db --backup-interval 1 --keep-backups 3 --vacuum-interval 2 --rebuild-index-interval 2`,
            env: {
                ...process.env,
                // Elevate rate limit boundary for test runner concurrency (simulating realistic clustered traffic)
                MCP_RATE_LIMIT_MAX: '1000',
                // Enable team DB so team tools get functional E2E coverage
                TEAM_DB_PATH: `./.test-output/e2e/test-e2e-team-worker-${i}.db`,
                TEAM_AUTHOR: 'Alice',
                DEFAULT_PROJECT_NUMBER: '1',
                ALLOWED_IO_ROOTS: process.cwd() + '/.test-output/e2e',
                METRICS_EXPORT: 'prometheus',
            },
            url: `http://localhost:${port}/health`,
            reuseExistingServer: !process.env.CI,
            timeout: 60000,
            stdout: 'pipe',
            stderr: 'pipe',
        };
    }),
})
