/**
 * memory-journal-mcp - Code Mode Security
 *
 * Security validation for sandboxed code execution.
 * Enforces code length limits, blocked patterns, rate limiting,
 * and result size caps.
 */

import {
    DEFAULT_SECURITY_CONFIG,
    type SecurityConfig,
    type ValidationResult,
} from './types.js'

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
            errors.push(
                `Code exceeds maximum length of ${String(this.config.maxCodeLength)} bytes`,
            )
        }

        // Empty code check
        if (code.trim().length === 0) {
            errors.push('Code cannot be empty')
        }

        // Blocked pattern scan
        for (const pattern of this.config.blockedPatterns) {
            if (pattern.test(code)) {
                errors.push(
                    `Code contains blocked pattern: ${pattern.source}`,
                )
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
            const serialized = JSON.stringify(result)
            if (Buffer.byteLength(serialized, 'utf-8') > this.config.maxResultSize) {
                errors.push(
                    `Result exceeds maximum size of ${String(this.config.maxResultSize)} bytes`,
                )
            }
        } catch {
            errors.push('Result could not be serialized to JSON')
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
