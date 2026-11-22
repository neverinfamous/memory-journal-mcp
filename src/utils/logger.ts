/**
 * Memory Journal MCP Server - Logger
 *
 * Centralized logging to stderr only (stdout reserved for MCP protocol).
 * Follows RFC 5424 severity levels.
 * Automatically sanitizes error fields to prevent token leakage.
 */

import { sanitizeErrorForLogging, SENSITIVE_KEY_RE } from './security-utils.js'
import { isCrossRealmDate, isCrossRealmError, tryResolveToJson } from './sanitize-value-helpers.js'

type LogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical'

interface LogContext {
    module?: string
    operation?: string
    entityId?: string | number
    [key: string]: unknown
}

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 7,
    info: 6,
    notice: 5,
    warning: 4,
    error: 3,
    critical: 2,
}

function sanitizeLogValue(value: unknown, seen = new WeakSet(), depth = 0): unknown {
    if (isCrossRealmError(value)) return sanitizeErrorForLogging(`${value.name}: ${value.message}`)
    if (isCrossRealmDate(value)) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
    if (value instanceof URL) return sanitizeErrorForLogging(value.toString())
    if (typeof value === 'string') return sanitizeErrorForLogging(value)
    if (typeof value === 'function') return '[Function]'
    if (typeof value === 'bigint') return value.toString()
    if (typeof value !== 'object' || value === null) return value
    if (depth > 6) return '[Truncated]'
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    try {
        if (Array.isArray(value)) {
            return value.map((item) => sanitizeLogValue(item, seen, depth + 1))
        }
        const jsonRes = tryResolveToJson(value)
        if (jsonRes.resolved) {
            return sanitizeLogValue(jsonRes.value, seen, depth + 1)
        }
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(value)) {
            if (k === '__proto__' || k === 'constructor' || k === 'prototype' || k === 'toJSON' || typeof v === 'function') continue
            const safeKey = sanitizeErrorForLogging(k)
            out[safeKey] =
                SENSITIVE_KEY_RE.test(k) && v !== undefined && v !== null && v !== ''
                    ? '[REDACTED]'
                    : sanitizeLogValue(v, seen, depth + 1)
        }
        return out
    } finally {
        seen.delete(value)
    }
}

class Logger {
    private minLevel: number

    constructor(level: LogLevel = 'info') {
        this.minLevel = LOG_LEVELS[level]
    }

    private shouldLog(level: LogLevel): boolean {
        return LOG_LEVELS[level] <= this.minLevel
    }

    private log(level: LogLevel, message: string, context?: LogContext): void {
        if (!this.shouldLog(level)) return

        // Sanitize all user-controlled inputs to prevent log injection (CodeQL js/log-injection).
        // Each .replace() must be applied inline — CodeQL cannot track sanitization through method calls.
        const safeMessage = sanitizeErrorForLogging(message).replace(/\n|\r/g, '')
        const timestamp = new Date().toISOString()
        const levelUpper = level.toUpperCase().padEnd(8)

        const mod = context?.module ? `[${context.module.replace(/\n|\r/g, '')}]` : ''
        const op = context?.operation ? `[${context.operation.replace(/\n|\r/g, '')}]` : ''

        let line = `[${timestamp}] [${levelUpper}] ${mod}${op} ${safeMessage}`

        // Add context as JSON if there are additional fields
        const extras: Record<string, unknown> = { ...context }
        delete extras['module']
        delete extras['operation']

        // Sanitize error and string fields recursively to prevent token/secret leakage in nested log contexts
        const sanitizedExtras: Record<string, unknown> = {}
        const rootSeen = new WeakSet()
        if (context !== undefined) rootSeen.add(context)
        for (const [k, v] of Object.entries(extras)) {
            if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
            const safeKey = sanitizeErrorForLogging(k)
            sanitizedExtras[safeKey] =
                SENSITIVE_KEY_RE.test(k) && v !== undefined && v !== null && v !== ''
                    ? '[REDACTED]'
                    : sanitizeLogValue(v, rootSeen, 0)
        }

        if (Object.keys(sanitizedExtras).length > 0) {
            try {
                const serialized = JSON.stringify(sanitizedExtras, (_k: string, val: unknown) =>
                    typeof val === 'bigint' ? val.toString() : val
                )
                line += ` ${serialized.replace(/\n|\r/g, '')}`
            } catch {
                line += ' {"_serializationError":"unserializable log context"}'
            }
        }

        // Always write to stderr (stdout is reserved for MCP protocol)
        // codeql[js/clear-text-logging] False positive: Logging public oauth issuer URL, not sensitive secrets
        console.error(line)
    }

    debug(message: string, context?: LogContext): void {
        this.log('debug', message, context)
    }

    info(message: string, context?: LogContext): void {
        this.log('info', message, context)
    }

    notice(message: string, context?: LogContext): void {
        this.log('notice', message, context)
    }

    warning(message: string, context?: LogContext): void {
        this.log('warning', message, context)
    }

    error(message: string, context?: LogContext): void {
        this.log('error', message, context)
    }

    critical(message: string, context?: LogContext): void {
        this.log('critical', message, context)
    }

    setLevel(level: LogLevel): void {
        const raw = typeof level === 'string' ? level.trim().toLowerCase() : ''
        const normalized = raw === 'warn' ? 'warning' : raw
        if (Object.hasOwn(LOG_LEVELS, normalized)) {
            const validLevel = normalized as LogLevel
            this.minLevel = LOG_LEVELS[validLevel]
            for (const listener of logLevelListeners) listener(validLevel)
        }
    }
}

type LogLevelListener = (level: LogLevel) => void
const logLevelListeners: LogLevelListener[] = []

/** Register a listener notified whenever `logger.setLevel` changes the active level. */
export function onLogLevelChange(listener: LogLevelListener): void {
    logLevelListeners.push(listener)
}

// Get log level from environment (validated against known levels; map 'warn' -> 'warning' for mcp-logger parity)
const rawLevelInput = (process.env['LOG_LEVEL'] ?? 'info').trim().toLowerCase()
const rawLevel = rawLevelInput === 'warn' ? 'warning' : rawLevelInput
const envLevel: LogLevel = Object.hasOwn(LOG_LEVELS, rawLevel) ? (rawLevel as LogLevel) : 'info'

export const logger = new Logger(envLevel)
