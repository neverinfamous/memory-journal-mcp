import { test, expect } from './test-fixture.js'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

test.describe('CLI Commands E2E', () => {
    const cliPath = resolve(process.cwd(), 'src/cli/index.ts')

    test('admin backup --help executes without configuration errors', () => {
        const output = execSync(`npx tsx ${cliPath} admin backup --help`, { encoding: 'utf-8' })
        expect(output).toContain('Usage: memory-journal-mcp admin backup')
        expect(output).not.toContain('Startup Configuration Errors')
    })

    test('entry create --help executes without configuration errors', () => {
        const output = execSync(`npx tsx ${cliPath} entry create --help`, { encoding: 'utf-8' })
        expect(output).toContain('Usage: memory-journal-mcp entry create')
        expect(output).not.toContain('Startup Configuration Errors')
    })
    
    test('admin prune --help executes without configuration errors', () => {
        const output = execSync(`npx tsx ${cliPath} admin prune --help`, { encoding: 'utf-8' })
        expect(output).toContain('Usage: memory-journal-mcp admin prune')
        expect(output).not.toContain('Startup Configuration Errors')
    })
})
