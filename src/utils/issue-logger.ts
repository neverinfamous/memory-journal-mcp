import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { sanitizeErrorForLogging } from './security-utils.js'

const SENSITIVE_KEY_RE =
    /(?:token|secret|password|passphrase|authorization|webhook_?auth|webhook_?url|encryption_?key|api_?key|private_?key|^key$)/i
const SENSITIVE_CLI_FLAG_RE =
    /^--(?:auth-token|report-webhook-auth|report-webhook-url|github-token|oauth-.*secret|key|password|secret|token)(?:=(.*))?$/i

function sanitizeCliArgList(
    args: unknown[],
    depth: number,
    seen: WeakSet<WeakKey>
): unknown[] {
    const out: unknown[] = []
    let redactNext = false
    for (const item of args) {
        if (redactNext) {
            out.push('[REDACTED]')
            redactNext = false
            continue
        }
        if (typeof item === 'string') {
            const flagMatch = SENSITIVE_CLI_FLAG_RE.exec(item)
            if (flagMatch !== null) {
                const eqIdx = item.indexOf('=')
                if (eqIdx !== -1) {
                    out.push(`${item.slice(0, eqIdx + 1)}[REDACTED]`)
                } else {
                    out.push(item)
                    redactNext = true
                }
                continue
            }
            out.push(truncateIssueString(sanitizeErrorForLogging(item)))
            continue
        }
        out.push(sanitizeIssueInput(item, depth + 1, seen))
    }
    return out
}

const MAX_ISSUE_STRING_LENGTH = 500

function truncateIssueString(val: string): string {
    if (val.length <= MAX_ISSUE_STRING_LENGTH) return val
    return `${val.slice(0, MAX_ISSUE_STRING_LENGTH)}...[truncated]`
}

export function sanitizeIssueInput(
    value: unknown,
    depth = 0,
    seen = new WeakSet()
): unknown {
    if (value === null || value === undefined) return value
    if (depth > 8) return '[Truncated]'
    if (typeof value === 'string') return truncateIssueString(sanitizeErrorForLogging(value))
    if (typeof value !== 'object') return value
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    try {
        if (Array.isArray(value)) {
            return sanitizeCliArgList(value, depth, seen)
        }
        const clean: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
            if (SENSITIVE_KEY_RE.test(k)) {
                clean[k] = '[REDACTED]'
            } else {
                clean[k] = sanitizeIssueInput(v, depth + 1, seen)
            }
        }
        return clean
    } finally {
        seen.delete(value)
    }
}

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
        input: sanitizeIssueInput(issue.input),
        error: sanitizeErrorForLogging(issue.error),
    }

    if (pendingLines.length >= MAX_PENDING_ISSUE_LINES) {
        pendingLines.shift()
    }
    pendingLines.push(JSON.stringify(fullIssue) + '\n')
    scheduleFlush()
}
