/**
 * Memory Journal MCP Server - MCP Protocol Logger
 *
 * Logging that sends structured messages via MCP notifications/message.
 * Falls back to stderr when MCP server is not connected.
 * Follows RFC 5424 severity levels as per MCP spec.
 */

import { type McpServer } from '@modelcontextprotocol/server'
import { sanitizeErrorForLogging } from './security-utils.js'

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

/**
 * MCP Protocol Logger
 *
 * Sends structured log messages via MCP notifications/message protocol.
 * Falls back to stderr when server not connected.
 */
export class McpLogger {
    private server: McpLoggingReceiver | null = null
    private minLevel: McpLogLevel = 'info'

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
        if (level in LOG_LEVEL_PRIORITY) {
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

    private sanitizeValue(value: unknown): unknown {
        if (typeof value === 'string') {
            return sanitizeErrorForLogging(value).replace(/[\r\n]+/g, ' ')
        }
        if (Array.isArray(value)) {
            return value.map((item) => this.sanitizeValue(item))
        }
        if (typeof value === 'object' && value !== null) {
            const sanitized: Record<string, unknown> = {}
            for (const [k, v] of Object.entries(value)) {
                sanitized[k] = this.sanitizeValue(v)
            }
            return sanitized
        }
        return value
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
        const module = loggerName ? `[${loggerName}]` : ''

        let formatted = `[${timestamp}] [${levelUpper}] ${module} ${sanitized.message}`

        // Add extra context (filter out message and module)
        const extras = Object.fromEntries(
            Object.entries(sanitized).filter(([key]) => key !== 'message' && key !== 'module')
        )

        if (Object.keys(extras).length > 0) {
            formatted += ` ${JSON.stringify(extras)}`
        }

        return formatted
    }

    /**
     * Send log message via MCP protocol or fallback to stderr
     */
    log(level: McpLogLevel, loggerName: string, data: LogData): void {
        if (!this.shouldLog(level)) return

        const sanitized = this.sanitizeData(data)

        // Send via MCP protocol if server connected
        if (this.server) {
            try {
                void Promise.resolve(
                    this.server.sendLoggingMessage({
                        level,
                        logger: loggerName,
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
        console.error(this.formatSanitizedForStderr(level, loggerName, sanitized))
    }

    // Convenience methods
    debug(loggerName: string, message: string, context?: Record<string, unknown>): void {
        this.log('debug', loggerName, { message, ...context })
    }

    info(loggerName: string, message: string, context?: Record<string, unknown>): void {
        this.log('info', loggerName, { message, ...context })
    }

    notice(loggerName: string, message: string, context?: Record<string, unknown>): void {
        this.log('notice', loggerName, { message, ...context })
    }

    warning(loggerName: string, message: string, context?: Record<string, unknown>): void {
        this.log('warning', loggerName, { message, ...context })
    }

    error(loggerName: string, message: string, context?: Record<string, unknown>): void {
        this.log('error', loggerName, { message, ...context })
    }

    critical(loggerName: string, message: string, context?: Record<string, unknown>): void {
        this.log('critical', loggerName, { message, ...context })
    }
}

// Singleton instance
export const mcpLogger = new McpLogger()
