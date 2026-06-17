import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        globals: true,
        isolate: true,
        environment: 'node',
        env: {
            TEAM_AUTHOR: 'test-author',
            DB_PATH: './.test-output/vitest/memory_journal.db',
            TEAM_DB_PATH: './.test-output/vitest/team_memory_journal.db',
        },
        globalSetup: ['./tests/global-teardown.ts'],
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'json-summary', 'lcov'],
            reportsDirectory: '.test-output/coverage',
            include: ['src/**/*.ts'],
            exclude: [
                'src/index.ts',
                'src/**/index.ts',
                'src/cli.ts',
                'src/codemode/worker-script.ts',
                'src/handlers/tools/core/fields-mixin.ts',
                'src/types/**',
            ],
        },
        hookTimeout: 30000,
        testTimeout: 10000,
        pool: 'forks',
        maxWorkers: 2,
        fileParallelism: true,
    },
})
