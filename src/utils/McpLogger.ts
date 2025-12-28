/**
 * Memory Journal MCP Server - MCP Protocol Logger
 * 
 * Logging that sends structured messages via MCP notifications/message.
 * Falls back to stderr when MCP server is not connected.
 * Follows RFC 5424 severity levels as per MCP spec.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

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
    | 'emergency';

const LOG_LEVEL_PRIORITY: Record<McpLogLevel, number> = {
    emergency: 0,
    alert: 1,
    critical: 2,
    error: 3,
    warning: 4,
    notice: 5,
    info: 6,
    debug: 7,
};

interface LogData {
    message: string;
    module?: string;
    operation?: string;
    [key: string]: unknown;
}

/**
 * MCP Protocol Logger
 * 
 * Sends structured log messages via MCP notifications/message protocol.
 * Falls back to stderr when server not connected.
 */
export class McpLogger {
    private server: McpServer | null = null;
    private minLevel: McpLogLevel = 'info';

    /**
     * Connect to MCP server for protocol logging
     */
    setServer(server: McpServer): void {
        this.server = server;
    }

    /**
     * Set minimum log level (from logging/setLevel request)
     */
    setLevel(level: McpLogLevel): void {
        if (level in LOG_LEVEL_PRIORITY) {
            this.minLevel = level;
        }
    }

    /**
     * Get current minimum log level
     */
    getLevel(): McpLogLevel {
        return this.minLevel;
    }

    /**
     * Check if a level should be logged
     */
    private shouldLog(level: McpLogLevel): boolean {
        return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[this.minLevel];
    }

    /**
     * Format message for stderr fallback
     */
    private formatForStderr(level: McpLogLevel, loggerName: string, data: LogData): string {
        const timestamp = new Date().toISOString();
        const levelUpper = level.toUpperCase().padEnd(9);
        const module = loggerName ? `[${loggerName}]` : '';

        let formatted = `[${timestamp}] [${levelUpper}] ${module} ${data.message}`;

        // Add extra context (filter out message and module)
        const extras = Object.fromEntries(
            Object.entries(data).filter(([key]) => key !== 'message' && key !== 'module')
        );

        if (Object.keys(extras).length > 0) {
            formatted += ` ${JSON.stringify(extras)}`;
        }

        return formatted;
    }

    /**
     * Send log message via MCP protocol or fallback to stderr
     */
    log(level: McpLogLevel, loggerName: string, data: LogData): void {
        if (!this.shouldLog(level)) return;

        // Send via MCP protocol if server connected
        if (this.server) {
            try {
                void this.server.sendLoggingMessage({
                    level,
                    logger: loggerName,
                    data,
                });
            } catch {
                // Fallback to stderr if MCP send fails
                console.error(this.formatForStderr(level, loggerName, data));
            }
        }

        // Always also log to stderr for local debugging
        console.error(this.formatForStderr(level, loggerName, data));
    }

    // Convenience methods
    debug(loggerName: string, message: string, context?: Record<string, unknown>): void {
        this.log('debug', loggerName, { message, ...context });
    }

    info(loggerName: string, message: string, context?: Record<string, unknown>): void {
        this.log('info', loggerName, { message, ...context });
    }

    notice(loggerName: string, message: string, context?: Record<string, unknown>): void {
        this.log('notice', loggerName, { message, ...context });
    }

    warning(loggerName: string, message: string, context?: Record<string, unknown>): void {
        this.log('warning', loggerName, { message, ...context });
    }

    error(loggerName: string, message: string, context?: Record<string, unknown>): void {
        this.log('error', loggerName, { message, ...context });
    }

    critical(loggerName: string, message: string, context?: Record<string, unknown>): void {
        this.log('critical', loggerName, { message, ...context });
    }
}

// Singleton instance
export const mcpLogger = new McpLogger();
