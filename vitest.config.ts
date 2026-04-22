import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        env: {
            TEAM_AUTHOR: 'test-author',
        },
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'json-summary'],
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
        hookTimeout: 30_000,
    },
})
