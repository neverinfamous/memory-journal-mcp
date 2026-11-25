import { test, expect } from './test-fixture.js'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

test.describe('CLI Commands E2E', () => {
    const distCliPath = resolve(process.cwd(), 'dist/cli.js')
    const emptyConfigPath = resolve(process.cwd(), 'tests/e2e/empty-config.json')

    test('admin backup --help executes without configuration errors', () => {
        const output = execFileSync(process.execPath, [distCliPath, 'admin', 'backup', '--help'], {
            cwd: process.cwd(),
            encoding: 'utf-8',
            stdio: 'pipe',
        })
        expect(output).toContain('Usage: memory-journal-mcp admin backup')
        expect(output).not.toContain('Startup Configuration Errors')
    })

    test('entry create --help executes without configuration errors', () => {
        const output = execFileSync(process.execPath, [distCliPath, 'entry', 'create', '--help'], {
            cwd: process.cwd(),
            encoding: 'utf-8',
            stdio: 'pipe',
        })
        expect(output).toContain('Usage: memory-journal-mcp entry create')
        expect(output).not.toContain('Startup Configuration Errors')
    })

    test('admin prune --help executes without configuration errors', () => {
        const output = execFileSync(process.execPath, [distCliPath, 'admin', 'prune', '--help'], {
            cwd: process.cwd(),
            encoding: 'utf-8',
            stdio: 'pipe',
        })
        expect(output).toContain('Usage: memory-journal-mcp admin prune')
        expect(output).not.toContain('Startup Configuration Errors')
    })

    test('aggregates multiple startup configuration validation errors on stderr', () => {
        let stderr = ''
        let failed = false
        try {
            execFileSync(
                process.execPath,
                [distCliPath, 'serve', '--port', 'abc', '--archive-older-than-days', '-5'],
                {
                    cwd: process.cwd(),
                    encoding: 'utf-8',
                    stdio: 'pipe',
                    env: {
                        ...process.env,
                        ALLOWED_IO_ROOTS: 'invalid-json',
                        MEMORY_JOURNAL_CONFIG: emptyConfigPath,
                        DB_ENCRYPTION_KEY: '',
                        MJ_DB_ENCRYPTION_KEY: '',
                    },
                }
            )
        } catch (error: unknown) {
            failed = true
            if (typeof error === 'object' && error !== null && 'stderr' in error) {
                stderr = String(error.stderr)
            }
        }
        expect(failed).toBe(true)
        expect(stderr).toContain('Startup Configuration Errors:')
        expect(stderr).toContain('numeric configuration for port')
        expect(stderr).toContain('Invalid ALLOWED_IO_ROOTS')
        expect(stderr).toContain('archiveOlderThanDays must be at least 0')
    })

    test('--dump-config redacts sensitive auth and OAuth environment variables', () => {
        const stdout = execFileSync(process.execPath, [distCliPath, '--dump-config'], {
            cwd: process.cwd(),
            encoding: 'utf-8',
            stdio: 'pipe',
            env: {
                ...process.env,
                MCP_AUTH_TOKEN: 'super-secret-token',
                OAUTH_ISSUER: 'https://secret.issuer',
                OAUTH_JWKS_URI: 'https://secret.jwks',
                MEMORY_JOURNAL_CONFIG: emptyConfigPath,
                DB_ENCRYPTION_KEY: '',
                MJ_DB_ENCRYPTION_KEY: '',
            },
        })
        const config = JSON.parse(stdout) as Record<string, unknown>
        expect(config['authToken']).toBe('[REDACTED]')
        expect(config['oauthIssuer']).toBe('[REDACTED]')
        expect(config['oauthJwksUri']).toBe('[REDACTED]')
        expect(config['transport']).toBe('stdio')
    })
})
