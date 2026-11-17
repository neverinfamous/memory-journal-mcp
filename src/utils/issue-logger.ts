import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
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

const loggedErrorObjects = new WeakSet()
const MAX_PENDING_ISSUE_LINES = 1000
let cachedLogsDir: string | null = null
let logsDirEnsured = false
const pendingLines: string[] = []
let flushScheduled = false
let activeFlush: Promise<void> = Promise.resolve()

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

async function drainIssueQueue(): Promise<void> {
    if (pendingLines.length === 0) return
    const batch = pendingLines.splice(0, pendingLines.length).join('')
    try {
        const logsDir = resolveLogsDir()
        if (!logsDirEnsured) {
            await fsPromises.mkdir(logsDir, { recursive: true })
            logsDirEnsured = true
        }
        const logFile = path.join(logsDir, 'agent-issues.jsonl')
        await fsPromises.appendFile(logFile, batch, 'utf8')
    } catch (e) {
        // Fail silently so we don't crash the main process if logging fails
        console.error('Failed to write to agent-issues.jsonl:', e)
    }
}

function scheduleFlush(): void {
    if (flushScheduled) return
    flushScheduled = true
    queueMicrotask(() => {
        flushScheduled = false
        activeFlush = activeFlush.then(() => drainIssueQueue())
    })
}

export async function flushAgentIssues(): Promise<void> {
    await drainIssueQueue()
    await activeFlush
}

export function logAgentIssue(
    issue: Omit<AgentIssue, 'timestamp' | 'level'>,
    dedupError?: unknown
): void {
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
    if (dedupError !== null && typeof dedupError === 'object') {
        if (loggedErrorObjects.has(dedupError)) return
        loggedErrorObjects.add(dedupError)
    }

    const fullIssue: AgentIssue = {
        timestamp: new Date().toISOString(),
        level: 'error',
        ...issue,
    }

    if (pendingLines.length >= MAX_PENDING_ISSUE_LINES) {
        pendingLines.shift()
    }
    pendingLines.push(JSON.stringify(fullIssue) + '\n')
    scheduleFlush()
}
