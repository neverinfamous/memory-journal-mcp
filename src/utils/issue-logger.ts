import * as fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SENSITIVE_KEY_RE, sanitizeErrorForLogging } from './security-utils.js'
import { isCrossRealmDate, isCrossRealmError, tryResolveToJson } from './sanitize-value-helpers.js'

const SENSITIVE_CLI_FLAG_RE =
    /^--(?:[a-z0-9_-]+[-_])?(?:auth[-_]?token|token|secret|password|passwd|passphrase|api[-_]?key|apikey|webhook[-_]?auth|encryption[-_]?key|private[-_]?key|key)(?:=(.*))?$/i

const MAX_ISSUE_STRING_LENGTH = 500
const MAX_ISSUE_RAW_SCRUB_CHARS = 1024
const MAX_ISSUE_COLLECTION_ITEMS = 50
const MAX_ISSUE_TOTAL_NODES = 250
const MAX_ISSUE_LINE_BYTES = 32_768
const MAX_ISSUE_LOG_BYTES = 10 * 1024 * 1024
const MAX_ISSUE_ARCHIVES = 3

function scrubAndTruncateIssueString(val: string, maxLen = MAX_ISSUE_STRING_LENGTH): string {
    const bounded = val.length > MAX_ISSUE_RAW_SCRUB_CHARS ? val.slice(0, MAX_ISSUE_RAW_SCRUB_CHARS) : val
    const clean = sanitizeErrorForLogging(bounded)
    return clean.length > maxLen || val.length > maxLen ? `${clean.slice(0, maxLen)}...[truncated]` : clean
}

function sanitizeCliArgList(
    args: unknown[],
    depth: number,
    seen: WeakSet<WeakKey>,
    budget: { count: number }
): unknown[] {
    const out: unknown[] = []
    let redactNext = false
    const limit = Math.min(args.length, MAX_ISSUE_COLLECTION_ITEMS)
    for (let i = 0; i < limit; i++) {
        const item = args[i]
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
            out.push(scrubAndTruncateIssueString(item))
            continue
        }
        out.push(sanitizeIssueInput(item, depth + 1, seen, budget))
    }
    if (args.length > MAX_ISSUE_COLLECTION_ITEMS) {
        out.push(`...[+${String(args.length - MAX_ISSUE_COLLECTION_ITEMS)} more]`)
    }
    return out
}

export function sanitizeIssueInput(
    value: unknown,
    depth = 0,
    seen = new WeakSet(),
    budget: { count: number } = { count: 0 }
): unknown {
    if (value === null || value === undefined) return value
    if (depth > 8 || budget.count >= MAX_ISSUE_TOTAL_NODES) return '[Truncated]'
    if (typeof value === 'string') return scrubAndTruncateIssueString(value)
    if (typeof value === 'bigint') return value.toString()
    if (typeof value !== 'object') return value
    if (isCrossRealmDate(value)) {
        return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
    }
    if (value instanceof URL) return scrubAndTruncateIssueString(value.href)
    if (isCrossRealmError(value)) return scrubAndTruncateIssueString(`${value.name}: ${value.message}`)
    if (seen.has(value)) return '[Circular]'
    budget.count++
    seen.add(value)
    try {
        if (Array.isArray(value)) {
            return sanitizeCliArgList(value, depth, seen, budget)
        }
        const jsonRes = tryResolveToJson(value)
        if (jsonRes.resolved) {
            return sanitizeIssueInput(jsonRes.value, depth + 1, seen, budget)
        }
        const clean: Record<string, unknown> = {}
        const entries = Object.entries(value as Record<string, unknown>)
        const limit = Math.min(entries.length, MAX_ISSUE_COLLECTION_ITEMS)
        for (let i = 0; i < limit; i++) {
            const pair = entries[i]
            if (pair === undefined) continue
            const [k, v] = pair
            if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
            const safeKey = scrubAndTruncateIssueString(k, 256)
            if (SENSITIVE_KEY_RE.test(k) || SENSITIVE_KEY_RE.test(safeKey)) {
                clean[safeKey] = '[REDACTED]'
            } else {
                clean[safeKey] = sanitizeIssueInput(v, depth + 1, seen, budget)
            }
        }
        if (entries.length > MAX_ISSUE_COLLECTION_ITEMS) {
            clean['_truncatedKeys'] = entries.length - MAX_ISSUE_COLLECTION_ITEMS
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

async function isUnsafeIssueFile(targetPath: string): Promise<boolean> {
    try {
        const info = await fsPromises.lstat(targetPath)
        return info.isSymbolicLink() || !info.isFile()
    } catch (err: unknown) {
        const code = err instanceof Error && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined
        return code !== 'ENOENT'
    }
}

async function rotateIssueLogIfNeeded(logFile: string): Promise<boolean> {
    try {
        const info = await fsPromises.lstat(logFile)
        if (info.isSymbolicLink() || !info.isFile()) return false
        if (info.size < MAX_ISSUE_LOG_BYTES) return true
        for (let i = MAX_ISSUE_ARCHIVES - 1; i >= 1; i--) {
            const oldArchive = `${logFile}.${String(i)}`
            const newArchive = `${logFile}.${String(i + 1)}`
            if ((await isUnsafeIssueFile(oldArchive)) || (await isUnsafeIssueFile(newArchive))) {
                return false
            }
            await fsPromises.rename(oldArchive, newArchive).catch(() => undefined)
        }
        const firstArchive = `${logFile}.1`
        if (await isUnsafeIssueFile(firstArchive)) return false
        await fsPromises.rename(logFile, firstArchive)
        return true
    } catch (err: unknown) {
        const code = err instanceof Error && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined
        return code === 'ENOENT'
    }
}

async function drainIssueQueue(): Promise<void> {
    if (pendingLines.length === 0) return
    const batch = pendingLines.splice(0, pendingLines.length).join('')
    try {
        const logsDir = resolveLogsDir()
        if (!logsDirEnsured) {
            await fsPromises.mkdir(logsDir, { recursive: true, mode: 0o700 })
            logsDirEnsured = true
        }
        const logFile = path.join(logsDir, 'agent-issues.jsonl')
        if (!(await rotateIssueLogIfNeeded(logFile))) return
        const fh = await fsPromises.open(
            logFile,
            fs.constants.O_WRONLY |
                fs.constants.O_CREAT |
                fs.constants.O_APPEND |
                (fs.constants.O_NOFOLLOW ?? 0),
            0o600
        )
        try {
            const fhStat = await fh.stat()
            if (!fhStat.isFile()) return
            await fh.writeFile(batch, 'utf8')
            await fh.chmod(0o600).catch(() => undefined)
        } finally {
            await fh.close()
        }
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
    activeFlush = activeFlush.then(() => drainIssueQueue())
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
        source: issue.source,
        action: scrubAndTruncateIssueString(issue.action, 256),
        input: sanitizeIssueInput(issue.input),
        error: scrubAndTruncateIssueString(issue.error, 2048),
    }

    if (pendingLines.length >= MAX_PENDING_ISSUE_LINES) {
        pendingLines.shift()
    }
    let serialized: string
    try {
        serialized = JSON.stringify(fullIssue, (_key: string, val: unknown) =>
            typeof val === 'bigint' ? val.toString() : val
        )
    } catch {
        serialized = JSON.stringify({
            timestamp: fullIssue.timestamp,
            level: fullIssue.level,
            source: fullIssue.source,
            action: fullIssue.action,
            input: '[Unserializable]',
            error: fullIssue.error,
        })
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_ISSUE_LINE_BYTES) {
        serialized = JSON.stringify({
            timestamp: fullIssue.timestamp,
            level: fullIssue.level,
            source: fullIssue.source,
            action: fullIssue.action,
            input: '[Truncated]',
            error: fullIssue.error.slice(0, 1024),
        })
    }
    pendingLines.push(serialized + '\n')
    scheduleFlush()
}
