/**
 * memory-journal-mcp - Code Mode Security
 *
 * Security validation for sandboxed code execution.
 * Enforces code length limits, blocked patterns, rate limiting,
 * and result size caps.
 */

import { DEFAULT_SECURITY_CONFIG, type SecurityConfig, type ValidationResult } from './types.js'
import * as v8 from 'node:v8'

// =============================================================================
// Single-Pass Lexical Comment & String Stripper
// =============================================================================

const SENSITIVE_STRING_CONTENT = /^(?:constructor|__proto__|prototype)$/i

/**
 * Single-pass lexical scanner that strips JS comments and string literal contents
 * in a single left-to-right pass while preserving:
 * 1. `${...}` template literal interpolation expressions (so blocked patterns inside
 *    `${...}` cannot evade static scanning)
 * 2. String literals whose exact content is `constructor`, `__proto__`, or `prototype`
 *    (so bracket-notation access checks like `['constructor']` remain detectable)
 * 3. Comment markers inside string literals (preventing `"/*"` ... `"*" + "/"` or `"//"`
 *    comment-stripping desynchronization bypasses)
 */
export function stripCommentsAndStrings(rawCode: string): string {
    const code = rawCode.normalize('NFKC')
    const len = code.length
    let out = ''
    let i = 0
    let lastNonWsToken = ''

    // Stack tracks brace depth inside template literal `${ ... }` interpolations.
    // When a `}` is reached at braceDepth === 0 for the top of templateStack,
    // the scanner resumes template literal scanning.
    const templateBraceDepthStack: number[] = []

    const canStartRegex = (prev: string): boolean => {
        if (!prev) return true
        if (/^[([{:;,=!?&|+-~*%^<>]$/.test(prev)) return true
        return /^(?:return|typeof|instanceof|in|of|void|delete|throw|new|case|yield|await)$/.test(
            prev
        )
    }

    while (i < len) {
        const ch = code[i] ?? ''
        const next = i + 1 < len ? (code[i + 1] ?? '') : ''

        // 1. Line comment: // ...
        if (ch === '/' && next === '/') {
            out += ' '
            i += 2
            while (i < len && code[i] !== '\n') {
                i++
            }
            continue
        }

        // 2. Block comment: /* ... */
        if (ch === '/' && next === '*') {
            out += ' '
            i += 2
            while (i < len && !(code[i] === '*' && code[i + 1] === '/')) {
                if (code[i] === '\n') out += '\n'
                i++
            }
            if (i < len) i += 2
            continue
        }

        // 2b. Regex literal: / ... /flags (prevents `/*` or `//` inside regex from desynchronizing comment stripping)
        if (ch === '/' && next !== '/' && next !== '*' && canStartRegex(lastNonWsToken)) {
            out += '/ /'
            i++
            let inCharClass = false
            while (i < len) {
                const c = code[i] ?? ''
                if (c === '\\') {
                    i += i + 1 < len ? 2 : 1
                    continue
                }
                if (c === '[') {
                    inCharClass = true
                } else if (c === ']') {
                    inCharClass = false
                } else if (c === '/' && !inCharClass) {
                    i++
                    while (i < len && /[dgimsuvy]/.test(code[i] ?? '')) {
                        i++
                    }
                    break
                } else if (c === '\n') {
                    break
                }
                i++
            }
            lastNonWsToken = '/'
            continue
        }

        // 3. Single or double quoted string literal
        if (ch === '"' || ch === "'") {
            const quote = ch
            i++
            let content = ''
            while (i < len) {
                const c = code[i] ?? ''
                if (c === '\\') {
                    if (i + 1 < len) {
                        content += code[i + 1] ?? ''
                        i += 2
                    } else {
                        i++
                    }
                    continue
                }
                if (c === quote) {
                    i++
                    break
                }
                content += c
                i++
            }
            if (SENSITIVE_STRING_CONTENT.test(content.trim())) {
                out += `${quote}${content.trim()}${quote}`
            } else {
                out += `${quote}${quote}`
            }
            lastNonWsToken = quote
            continue
        }

        // 4. Template literal opening or resumption after `${ ... }`
        if (ch === '`' || (ch === '}' && templateBraceDepthStack.length > 0 && templateBraceDepthStack[templateBraceDepthStack.length - 1] === 0)) {
            if (ch === '}') {
                templateBraceDepthStack.pop()
                out += ')`'
            } else {
                out += '`'
            }
            i++
            let content = ''
            while (i < len) {
                const c = code[i] ?? ''
                if (c === '\\') {
                    if (i + 1 < len) {
                        content += code[i + 1] ?? ''
                        i += 2
                    } else {
                        i++
                    }
                    continue
                }
                if (c === '$' && code[i + 1] === '{') {
                    // Enter interpolation expression: preserve code inside `${ ... }`
                    out += '`' + '+('
                    templateBraceDepthStack.push(0)
                    lastNonWsToken = '('
                    i += 2
                    break
                }
                if (c === '`') {
                    if (SENSITIVE_STRING_CONTENT.test(content.trim())) {
                        out += `${content.trim()}\``
                    } else {
                        out += '`'
                    }
                    lastNonWsToken = '`'
                    i++
                    break
                }
                content += c
                i++
            }
            continue
        }

        // Track nested `{` and `}` when inside a template literal `${ ... }` expression
        if (templateBraceDepthStack.length > 0) {
            const topIdx = templateBraceDepthStack.length - 1
            const currentDepth = templateBraceDepthStack[topIdx] ?? 0
            if (ch === '{') {
                templateBraceDepthStack[topIdx] = currentDepth + 1
            } else if (ch === '}' && currentDepth > 0) {
                templateBraceDepthStack[topIdx] = currentDepth - 1
            }
        }

        if (!/\s/.test(ch)) {
            lastNonWsToken = ch
        }
        out += ch
        i++
    }

    return out
}

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
    private readonly cleanupInterval: NodeJS.Timeout

    constructor(config?: Partial<SecurityConfig>) {
        this.config = { ...DEFAULT_SECURITY_CONFIG, ...config }
        // Periodically drop expired rate limit entries to prevent memory leaks
        this.cleanupInterval = setInterval(() => this.cleanupRateLimits(), 60_000)
        this.cleanupInterval.unref() // Don't block process exit
    }

    /**
     * Stop the cleanup interval to prevent memory leaks when this manager is evicted.
     */
    dispose(): void {
        clearInterval(this.cleanupInterval)
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

        // Single-pass lexical scan to strip comments and string contents while preserving
        // template literal `${...}` expressions and sensitive bracket-access strings
        const strippedCode = stripCommentsAndStrings(code)

        // Blocked pattern scan
        for (const pattern of this.config.blockedPatterns) {
            if (pattern.test(strippedCode)) {
                let hint = ''
                if (pattern.source.includes('require') || pattern.source.includes('import')) {
                    hint = ' Dynamic require() and ES module import statements are disabled in sandboxed Code Mode. To manage journal entries or settings, use mj.* tools directly (e.g., `await mj.core.createEntry({ content: "..." })` or `await mj.search.searchEntries({ query: "..." })`).'
                } else if (pattern.source.includes('fs')) {
                    hint = ' Node.js filesystem access is disabled in sandboxed Code Mode. To query database metrics, health, or journal entries, use `await mj.analytics.getStatistics()` or `await mj.core.getRecentEntries()`. File existence and stat queries on database paths are auto-healed in Code Mode.'
                } else if (pattern.source.includes('process')) {
                    hint = ' Process access is disabled in sandboxed Code Mode.'
                }
                errors.push(`🛠️ AUTONOMOUS HEALING: Code contains blocked pattern: ${pattern.source}.${hint}`)
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

        // Pre-flight checks to prevent OOM / V8 crashes on massive explicit arrays/strings
        if (typeof result === 'string' && result.length > this.config.maxResultSize) {
            const limitKb = Math.ceil(this.config.maxResultSize / 1024)
            errors.push(
                `Result string exceeds maximum approximate size of ${String(limitKb)} KB. Extract specific fields or aggregate data.`
            )
            return { valid: false, errors }
        }

        if (Array.isArray(result) && result.length > 1000) {
            errors.push(
                `Result array exceeds maximum length of 1000 elements (${String(result.length)} returned). Aggregate data or reduce limit before returning.`
            )
            return { valid: false, errors }
        }

        try {
            // Use v8.serialize for high-performance memory footprint calculation
            // without triggering V8 cross-thread string allocation limits.
            let actualBytes = 0
            try {
                actualBytes = v8.serialize(result).length
            } catch {
                // Fallback to safe JSON serialization if v8 encounters uncloneable data or cyclic references
                const cache = new Set()
                actualBytes = Buffer.byteLength(
                    JSON.stringify(result, (_key: string, value: unknown): unknown => {
                        if (typeof value === 'object' && value !== null) {
                            if (cache.has(value)) return '[Circular]'
                            cache.add(value)
                        }
                        return value
                    }) || '',
                    'utf-8'
                )
            }

            if (actualBytes > this.config.maxResultSize) {
                const actualKb = Math.ceil(actualBytes / 1024)
                const limitKb = Math.ceil(this.config.maxResultSize / 1024)
                errors.push(
                    `🛠️ AUTONOMOUS HEALING: Result exceeds maximum size of ${String(limitKb)} KB (${String(actualKb)} KB returned). ` +
                        `Extract specific fields or aggregate data before returning, or pass max_result_size in mj_execute_code parameters. ` +
                        `Example: instead of \`return await mj.github.getKanbanBoard(5)\`, use ` +
                        `\`const b = await mj.github.getKanbanBoard(5); return { columns: b.columns?.length ?? 0, totalItems: b.totalItems }\``
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
