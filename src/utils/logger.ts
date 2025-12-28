/**
 * Memory Journal MCP Server - Logger
 * 
 * Centralized logging to stderr only (stdout reserved for MCP protocol).
 * Follows RFC 5424 severity levels.
 */

type LogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical';

interface LogContext {
    module?: string;
    operation?: string;
    entityId?: string | number;
    [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 7,
    info: 6,
    notice: 5,
    warning: 4,
    error: 3,
    critical: 2,
};

class Logger {
    private minLevel: number;

    constructor(level: LogLevel = 'info') {
        this.minLevel = LOG_LEVELS[level];
    }

    private shouldLog(level: LogLevel): boolean {
        return LOG_LEVELS[level] <= this.minLevel;
    }

    private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
        const timestamp = new Date().toISOString();
        const levelUpper = level.toUpperCase().padEnd(8);
        const module = context?.module ? `[${context.module}]` : '';
        const operation = context?.operation ? `[${context.operation}]` : '';

        let formatted = `[${timestamp}] [${levelUpper}] ${module}${operation} ${message}`;

        // Add context as JSON if there are additional fields
        const extras = { ...context };
        delete extras.module;
        delete extras.operation;

        if (Object.keys(extras).length > 0) {
            formatted += ` ${JSON.stringify(extras)}`;
        }

        return formatted;
    }

    private log(level: LogLevel, message: string, context?: LogContext): void {
        if (!this.shouldLog(level)) return;

        const formatted = this.formatMessage(level, message, context);

        // Always write to stderr (stdout is reserved for MCP protocol)
        console.error(formatted);
    }

    debug(message: string, context?: LogContext): void {
        this.log('debug', message, context);
    }

    info(message: string, context?: LogContext): void {
        this.log('info', message, context);
    }

    notice(message: string, context?: LogContext): void {
        this.log('notice', message, context);
    }

    warning(message: string, context?: LogContext): void {
        this.log('warning', message, context);
    }

    error(message: string, context?: LogContext): void {
        this.log('error', message, context);
    }

    critical(message: string, context?: LogContext): void {
        this.log('critical', message, context);
    }

    setLevel(level: LogLevel): void {
        this.minLevel = LOG_LEVELS[level];
    }
}

// Get log level from environment
const envLevel = (process.env['LOG_LEVEL'] ?? 'info') as LogLevel;

export const logger = new Logger(envLevel);
