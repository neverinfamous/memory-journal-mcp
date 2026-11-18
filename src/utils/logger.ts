/**
 * Memory Journal MCP Server - Logger
 *
 * Centralized logging to stderr only (stdout reserved for MCP protocol).
 * Follows RFC 5424 severity levels.
 * Automatically sanitizes error fields to prevent token leakage.
 */

import { sanitizeErrorForLogging } from './security-utils.js'

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

        // Sanitize error and string fields to prevent token leakage and empty Error JSON serialization
        for (const [k, v] of Object.entries(extras)) {
            if (v instanceof Error) {
                extras[k] = sanitizeErrorForLogging(`${v.name}: ${v.message}`)
            } else if (typeof v === 'string') {
                extras[k] = sanitizeErrorForLogging(v)
            } else if (typeof v === 'bigint') {
                extras[k] = v.toString()
            }
        }

        if (Object.keys(extras).length > 0) {
            try {
                const seen = new WeakSet()
                const serialized = JSON.stringify(extras, (_k: string, val: unknown) => {
                    if (typeof val === 'bigint') return val.toString()
                    if (typeof val === 'object' && val !== null) {
                        if (seen.has(val)) return '[Circular]'
                        seen.add(val)
                    }
                    return val
                })
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
        const normalized = typeof level === 'string' ? level.trim().toLowerCase() : ''
        if (Object.hasOwn(LOG_LEVELS, normalized)) {
            this.minLevel = LOG_LEVELS[normalized as LogLevel]
        }
    }
}

// Get log level from environment (validated against known levels)
const rawLevel = (process.env['LOG_LEVEL'] ?? 'info').trim().toLowerCase()
const envLevel: LogLevel = Object.hasOwn(LOG_LEVELS, rawLevel) ? (rawLevel as LogLevel) : 'info'

export const logger = new Logger(envLevel)
