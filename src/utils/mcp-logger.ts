/**
 * Memory Journal MCP Server - MCP Protocol Logger
 *
 * Logging that sends structured messages via MCP notifications/message.
 * Falls back to stderr when MCP server is not connected.
 * Follows RFC 5424 severity levels as per MCP spec.
 */

import { type McpServer } from '@modelcontextprotocol/server'
import { sanitizeErrorForLogging, SENSITIVE_KEY_RE } from './security-utils.js'
import { isCrossRealmDate, isCrossRealmError, tryResolveToJson } from './sanitize-value-helpers.js'
import { onLogLevelChange } from './logger.js'

/**
 * Narrow interface for MCP protocol log notification dispatch.
 * Decouples McpLogger from the SDK's SEP-2577 deprecation annotation on McpServer
 * while maintaining backward-compatible notifications/message support.
 */
export interface McpLoggingReceiver {
    sendLoggingMessage(params: {
        level: McpLogLevel
        logger?: string
        data: unknown
    }): Promise<void> | void
}

/**
 * MCP log levels per RFC 5424
 */
export type McpLogLevel =
    | 'debug'
    | 'info'
    | 'notice'
    | 'warning'
    | 'error'
    | 'critical'
    | 'alert'
    | 'emergency'

const LOG_LEVEL_PRIORITY: Record<McpLogLevel, number> = {
    emergency: 0,
    alert: 1,
    critical: 2,
    error: 3,
    warning: 4,
    notice: 5,
    info: 6,
    debug: 7,
}

interface LogData {
    message: string
    module?: string
    operation?: string
    [key: string]: unknown
}

const VALID_MCP_LOG_LEVELS: readonly McpLogLevel[] = [
    'emergency',
    'alert',
    'critical',
    'error',
    'warning',
    'notice',
    'info',
    'debug',
]

function resolveInitialMcpLogLevel(): McpLogLevel {
    const raw = process.env['LOG_LEVEL']?.trim().toLowerCase()
    if (raw === 'warn') return 'warning'
    return VALID_MCP_LOG_LEVELS.find((lvl) => lvl === raw) ?? 'info'
}

/**
 * MCP Protocol Logger
 *
 * Sends structured log messages via MCP notifications/message protocol.
 * Falls back to stderr when server not connected.
 */
export class McpLogger {
    private server: McpLoggingReceiver | null = null
    private minLevel: McpLogLevel = resolveInitialMcpLogLevel()

    /**
     * Connect to MCP server for protocol logging
     */
    setServer(server: McpServer | McpLoggingReceiver): void {
        this.server = server
    }

    /**
     * Set minimum log level (from logging/setLevel request)
     */
    setLevel(level: McpLogLevel): void {
        if (Object.hasOwn(LOG_LEVEL_PRIORITY, level)) {
            this.minLevel = level
        }
    }

    /**
     * Get current minimum log level
     */
    getLevel(): McpLogLevel {
        return this.minLevel
    }

    /**
     * Check if a level should be logged
     */
    private shouldLog(level: McpLogLevel): boolean {
        return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[this.minLevel]
    }

    private sanitizeValue(
        value: unknown,
        depth = 0,
        seen = new WeakSet()
    ): unknown {
        if (isCrossRealmError(value)) {
            return sanitizeErrorForLogging(`${value.name}: ${value.message}`).replace(
                /[\r\n]+/g,
                ' '
            )
        }
        if (typeof value === 'string') {
            return sanitizeErrorForLogging(value).replace(/[\r\n]+/g, ' ')
        }
        if (typeof value === 'bigint') {
            return value.toString()
        }
        if (isCrossRealmDate(value)) {
            return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
        }
        if (value instanceof URL) {
            return sanitizeErrorForLogging(value.toString())
        }
        if (value === null || typeof value !== 'object') {
            return value
        }
        if (seen.has(value)) {
            return '[Circular]'
        }
        if (depth >= 6) {
            return '[Truncated]'
        }
        seen.add(value)
        try {
            if (Array.isArray(value)) {
                return value.map((item) => this.sanitizeValue(item, depth + 1, seen))
            }
            const jsonRes = tryResolveToJson(value)
            if (jsonRes.resolved) {
                return this.sanitizeValue(jsonRes.value, depth + 1, seen)
            }
            const sanitized: Record<string, unknown> = {}
            Object.setPrototypeOf(sanitized, null)
            for (const [k, v] of Object.entries(value)) {
                if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
                const safeKey = sanitizeErrorForLogging(k)
                sanitized[safeKey] =
                    SENSITIVE_KEY_RE.test(k) && v !== undefined && v !== null && v !== ''
                        ? '[REDACTED]'
                        : this.sanitizeValue(v, depth + 1, seen)
            }
            return sanitized
        } finally {
            seen.delete(value)
        }
    }

    private sanitizeData(data: LogData): LogData {
        const cleanedMessage =
            typeof data.message === 'string'
                ? sanitizeErrorForLogging(data.message).replace(/[\r\n]+/g, ' ')
                : ''
        const rest = this.sanitizeValue(data) as Record<string, unknown>
        return { ...rest, message: cleanedMessage }
    }

    /**
     * Format message for stderr fallback
     */
    private formatSanitizedForStderr(level: McpLogLevel, loggerName: string, sanitized: LogData): string {
        const timestamp = new Date().toISOString()
        const levelUpper = level.toUpperCase().padEnd(9)
        const safeLogger = sanitizeErrorForLogging(loggerName).replace(/[\r\n]+/g, ' ')
        const module = safeLogger ? `[${safeLogger}]` : ''

        let formatted = `[${timestamp}] [${levelUpper}] ${module} ${sanitized.message}`

        // Add extra context (filter out message and module)
        const extras = Object.fromEntries(
            Object.entries(sanitized).filter(([key]) => key !== 'message' && key !== 'module')
        )

        if (Object.keys(extras).length > 0) {
            try {
                formatted += ` ${JSON.stringify(extras)}`
            } catch {
                formatted += ' {"_serializationError":"unserializable log context"}'
            }
        }

        return formatted
    }

    /**
     * Send log message via MCP protocol or fallback to stderr
     */
    log(level: McpLogLevel, loggerName: string, data: LogData): void {
        if (!this.shouldLog(level)) return

        const sanitized = this.sanitizeData(data)
        const safeLogger = sanitizeErrorForLogging(loggerName).replace(/[\r\n]+/g, ' ')

        // Send via MCP protocol if server connected
        if (this.server) {
            try {
                void Promise.resolve(
                    this.server.sendLoggingMessage({
                        level,
                        logger: safeLogger,
                        data: sanitized,
                    })
                ).catch(() => {
                    // stderr fallback is written below
                })
            } catch {
                // stderr fallback is written below
            }
        }

        // Always also log to stderr for local debugging
        console.error(this.formatSanitizedForStderr(level, safeLogger, sanitized))
    }

    // Convenience methods
    debug(loggerName: string, message: string, context?: Record<string, unknown>): void {
        if (!this.shouldLog('debug')) return
        this.log('debug', loggerName, { message, ...context })
    }

    info(loggerName: string, message: string, context?: Record<string, unknown>): void {
        if (!this.shouldLog('info')) return
        this.log('info', loggerName, { message, ...context })
    }

    notice(loggerName: string, message: string, context?: Record<string, unknown>): void {
        if (!this.shouldLog('notice')) return
        this.log('notice', loggerName, { message, ...context })
    }

    warning(loggerName: string, message: string, context?: Record<string, unknown>): void {
        if (!this.shouldLog('warning')) return
        this.log('warning', loggerName, { message, ...context })
    }

    error(loggerName: string, message: string, context?: Record<string, unknown>): void {
        if (!this.shouldLog('error')) return
        this.log('error', loggerName, { message, ...context })
    }

    critical(loggerName: string, message: string, context?: Record<string, unknown>): void {
        if (!this.shouldLog('critical')) return
        this.log('critical', loggerName, { message, ...context })
    }
}

// Singleton instance
export const mcpLogger = new McpLogger()
onLogLevelChange((level) => {
    mcpLogger.setLevel(level)
})
