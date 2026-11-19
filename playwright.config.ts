import { defineConfig } from '@playwright/test'
import path from 'node:path'

process.env['DISABLE_ISSUE_LOGGING'] ??= 'true'

const WORKERS = Number(process.env.PLAYWRIGHT_WORKERS || 4)

const createWebServerConfig = (workerIndex: number) => {
    const port = 3105 + workerIndex
    return {
        command: `node dist/cli.js --transport http --port ${port} --db ./.test-output/e2e/test-e2e-worker-${workerIndex}.db`,
        env: {
            ...process.env,
            DISABLE_ISSUE_LOGGING: 'true',
            MCP_RATE_LIMIT_MAX: '1000',
            TEAM_DB_PATH: `./.test-output/e2e/test-e2e-team-worker-${workerIndex}.db`,
            TEAM_AUTHOR: 'Alice',
            DEFAULT_PROJECT_NUMBER: '1',
            ALLOWED_IO_ROOTS: path.join(process.cwd(), '.test-output', 'e2e'),
            METRICS_EXPORT: 'prometheus',
            MEMORY_JOURNAL_CONFIG: path.join(process.cwd(), 'tests', 'e2e', 'empty-config.json'),
            // [INTENT] Staleness checks refuse a workspace that has no registered repository path.
            PROJECT_REGISTRY: JSON.stringify({
                default: { path: process.cwd(), project_number: 1 },
            }),
        },
        url: `http://localhost:${port}/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 60000,
        stdout: 'pipe' as const,
        stderr: 'pipe' as const,
    }
}

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 60000,
    outputDir: '.test-output/playwright',
    fullyParallel: true,
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
            use: {
                baseURL: 'http://localhost:3105',
            },
        },
    ],
    webServer: Array.from({ length: WORKERS }, (_, i) => createWebServerConfig(i)),
})
