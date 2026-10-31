import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { logAgentIssue } from '../../src/utils/issue-logger.js'

describe('logAgentIssue Environment Filtering', () => {
    const originalEnv = { ...process.env }
    const __filename = fileURLToPath(import.meta.url)
    let rootDir = path.dirname(__filename)
    while (!fs.existsSync(path.join(rootDir, 'package.json')) && rootDir !== path.parse(rootDir).root) {
        rootDir = path.dirname(rootDir)
    }
    const logFile = path.join(rootDir, 'logs', 'agent-issues.jsonl')

    beforeEach(() => {
        process.env = { ...originalEnv }
    })

    afterEach(() => {
        process.env = originalEnv
    })

    it('should suppress issue logging when VITEST is defined', () => {
        process.env['VITEST'] = 'true'
        delete process.env['NODE_ENV']

        const initialSize = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0

        logAgentIssue({
            source: 'MCP',
            action: 'test_action',
            input: {},
            error: 'Test error',
        })

        const finalSize = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0
        expect(finalSize).toBe(initialSize)
    })

    it('should suppress issue logging when DISABLE_ISSUE_LOGGING is set to true', () => {
        delete process.env['NODE_ENV']
        delete process.env['VITEST']
        delete process.env['VITEST_WORKER_ID']
        process.env['DISABLE_ISSUE_LOGGING'] = 'true'

        const initialSize = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0

        logAgentIssue({
            source: 'CLI',
            action: 'cli_action',
            input: {},
            error: 'Test CLI error',
        })

        const finalSize = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0
        expect(finalSize).toBe(initialSize)
    })
})
