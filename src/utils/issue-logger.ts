import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

export interface AgentIssue {
    timestamp: string
    level: 'error' | 'warn' | 'info'
    source: 'CLI' | 'MCP'
    action: string
    input: unknown
    error: string
}

let cachedLogsDir: string | null = null

function resolveLogsDir(): string {
    if (cachedLogsDir !== null) {
        return cachedLogsDir
    }
    const __filename = fileURLToPath(import.meta.url)
    let rootDir = path.dirname(__filename)
    while (!fs.existsSync(path.join(rootDir, 'package.json')) && rootDir !== path.parse(rootDir).root) {
        rootDir = path.dirname(rootDir)
    }
    cachedLogsDir = path.join(rootDir, 'logs')
    return cachedLogsDir
}

export function logAgentIssue(issue: Omit<AgentIssue, 'timestamp' | 'level'>): void {
    if (
        process.env['NODE_ENV'] === 'test' ||
        process.env['VITEST'] !== undefined ||
        process.env['VITEST_WORKER_ID'] !== undefined ||
        process.env['PLAYWRIGHT_TEST'] !== undefined ||
        process.env['E2E_TEST'] === 'true' ||
        process.env['DISABLE_ISSUE_LOGGING'] === 'true'
    ) {
        return
    }

    const fullIssue: AgentIssue = {
        timestamp: new Date().toISOString(),
        level: 'error',
        ...issue,
    }

    try {
        const logsDir = resolveLogsDir()

        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true })
        }

        const logFile = path.join(logsDir, 'agent-issues.jsonl')
        fs.appendFileSync(logFile, JSON.stringify(fullIssue) + '\n')
    } catch (e) {
        // Fail silently so we don't crash the main process if logging fails
        console.error('Failed to write to agent-issues.jsonl:', e)
    }
}
