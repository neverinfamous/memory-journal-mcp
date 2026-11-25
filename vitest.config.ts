import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url))
const TESTS_DIR = path.join(ROOT_DIR, 'tests')
const ISOLATION_PATTERN =
    /\bvi\.(?:mock|doMock|stubGlobal|stubEnv|resetModules|useFakeTimers)\b|\bprocess\.chdir\b/

/**
 * Files free of module mocks/env-writes that still mutate shared module singletons
 * across tests and therefore require worker isolation.
 */
const EXTRA_ISOLATED_TESTS: readonly string[] = []

function collectIsolatedTestFiles(dir: string): string[] {
    const isolated: string[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            isolated.push(...collectIsolatedTestFiles(fullPath))
        } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
            const content = fs.readFileSync(fullPath, 'utf8')
            if (ISOLATION_PATTERN.test(content)) {
                isolated.push(path.relative(ROOT_DIR, fullPath).replaceAll('\\', '/'))
            }
        }
    }
    return isolated
}

const isolatedTestFiles = Array.from(
    new Set([...collectIsolatedTestFiles(TESTS_DIR), ...EXTRA_ISOLATED_TESTS])
).sort()

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        env: {
            TEAM_AUTHOR: 'test-author',
            DB_PATH: ':memory:',
            TEAM_DB_PATH: ':memory:',
            DISABLE_ISSUE_LOGGING: 'true',
            DB_ENCRYPTION_KEY: '',
            MJ_DB_ENCRYPTION_KEY: '',
        },
        globalSetup: ['./tests/global-teardown.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'text-summary', 'html', 'json-summary', 'lcov'],
            reportsDirectory: '.test-output/coverage',
            include: ['src/**/*.ts'],
            exclude: [
                'src/index.ts',
                'src/**/index.ts',
                'src/handlers/tools/core/fields-mixin.ts',
                'src/types/**',
                'src/**/types.ts',
                'src/database/core/interfaces.ts',
                'src/vendor/**',
            ],
        },
        hookTimeout: 30000,
        testTimeout: 30000,
        pool: 'threads',
        fileParallelism: true,
        maxWorkers: '50%',
        projects: [
            {
                extends: true,
                test: {
                    name: 'isolated',
                    pool: 'forks',
                    isolate: true,
                    include: isolatedTestFiles,
                },
            },
            {
                extends: true,
                test: {
                    name: 'unit',
                    isolate: false,
                    setupFiles: ['./tests/vitest-env-reset.ts'],
                    include: ['tests/**/*.test.ts'],
                    exclude: ['**/node_modules/**', '**/dist/**', ...isolatedTestFiles],
                },
            },
        ],
    },
})
