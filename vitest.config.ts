import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            reportsDirectory: '.test-output/coverage',
            include: ['src/**/*.ts'],
            exclude: ['src/cli.ts', 'src/index.ts', 'src/transports/http.ts', 'src/types/**', 'src/codemode/worker-script.ts'],
        },
    },
    benchmark: {
        hookTimeout: 30_000,
    },
})
