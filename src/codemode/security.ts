/**
 * memory-journal-mcp - Code Mode Security
 *
 * Security validation for sandboxed code execution.
 * Enforces code length limits, blocked patterns, rate limiting,
 * and result size caps.
 */

import { DEFAULT_SECURITY_CONFIG, type SecurityConfig, type ValidationResult } from './types.js'

// =============================================================================
// Rate Limiter
// =============================================================================

interface RateLimitEntry {
    count: number
    resetTime: number
}

// =============================================================================
// Security Manager
// =============================================================================

/**
 * Validates user-submitted code against security policies before execution.
 */
export class CodeModeSecurityManager {
    private readonly config: SecurityConfig
    private readonly rateLimits = new Map<string, RateLimitEntry>()

    constructor(config?: Partial<SecurityConfig>) {
        this.config = { ...DEFAULT_SECURITY_CONFIG, ...config }
    }

    // =========================================================================
    // Code Validation
    // =========================================================================

    /**
     * Validate code against all security policies.
     * Returns a ValidationResult with any violations found.
     */
    validateCode(code: string): ValidationResult {
        const errors: string[] = []

        // Length check
        if (Buffer.byteLength(code, 'utf-8') > this.config.maxCodeLength) {
            errors.push(`Code exceeds maximum length of ${String(this.config.maxCodeLength)} bytes`)
        }

        // Empty code check
        if (code.trim().length === 0) {
            errors.push('Code cannot be empty')
        }

        // Blocked pattern scan
        for (const pattern of this.config.blockedPatterns) {
            if (pattern.test(code)) {
                errors.push(`Code contains blocked pattern: ${pattern.source}`)
            }
        }

        return {
            valid: errors.length === 0,
            errors,
        }
    }

    // =========================================================================
    // Rate Limiting
    // =========================================================================

    /**
     * Check if a client has exceeded the rate limit.
     * Returns true if the execution is allowed.
     */
    checkRateLimit(clientId: string): boolean {
        const now = Date.now()
        const windowMs = 60_000 // 1 minute window
        const entry = this.rateLimits.get(clientId)

        if (!entry || now > entry.resetTime) {
            this.rateLimits.set(clientId, {
                count: 1,
                resetTime: now + windowMs,
            })
            return true
        }

        if (entry.count >= this.config.maxExecutionsPerMinute) {
            return false
        }

        entry.count++
        return true
    }

    /**
     * Clean up expired rate limit entries.
     * Should be called periodically to prevent memory leaks.
     */
    cleanupRateLimits(): void {
        const now = Date.now()
        for (const [clientId, entry] of this.rateLimits) {
            if (now > entry.resetTime) {
                this.rateLimits.delete(clientId)
            }
        }
    }

    // =========================================================================
    // Result Validation
    // =========================================================================

    /**
     * Validate that a result does not exceed size limits.
     */
    validateResultSize(result: unknown): ValidationResult {
        const errors: string[] = []
        try {
            // Stringify and measure length iteratively or just check the resulting buffer bounds safely.
            // In Node, creating a huge string can trigger V8 allocation limits (max ~1GB).
            // A safer bounds check limits string allocation immediately.
            const serialized = JSON.stringify(result)

            // If stringification succeeded but the string itself is larger than the limit
            if (Buffer.byteLength(serialized, 'utf-8') > this.config.maxResultSize) {
                const actualKb = Math.round(Buffer.byteLength(serialized, 'utf-8') / 1024)
                const limitKb = Math.round(this.config.maxResultSize / 1024)
                errors.push(
                    `Result exceeds maximum size of ${String(limitKb)} KB (${String(actualKb)} KB returned). ` +
                        `Extract specific fields or aggregate data before returning. ` +
                        `Example: instead of \`return await mj.github.getKanbanBoard(5)\`, use ` +
                        `\`const b = await mj.github.getKanbanBoard(5); return { columns: b.columns.length, totalItems: b.totalItems }\``
                )
            }
        } catch (error) {
            if (error instanceof RangeError || String(error).includes('Invalid string length')) {
                errors.push(
                    `Result exceeds V8 string length allocation limits (> ~${String(this.config.maxResultSize)} bytes)`
                )
            } else {
                errors.push('Result could not be serialized to JSON')
            }
        }
        return {
            valid: errors.length === 0,
            errors,
        }
    }

    // =========================================================================
    // Accessors
    // =========================================================================

    /** Get the current security configuration */
    getConfig(): Readonly<SecurityConfig> {
        return this.config
    }
}
