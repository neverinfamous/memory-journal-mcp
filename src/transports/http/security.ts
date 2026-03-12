/**
 * memory-journal-mcp — HTTP Transport Security
 *
 * Security utilities: rate limiting, headers, CORS, client IP extraction.
 */

import type { Request, Response } from 'express'
import type { HttpTransportConfig, RateLimitEntry } from './types.js'
import { DEFAULT_RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_MAX_REQUESTS, DEFAULT_HSTS_MAX_AGE } from './types.js'

// =============================================================================
// Client IP Extraction
// =============================================================================

/**
 * Extract the client IP address from the request.
 * When trustProxy is enabled, uses the leftmost IP from X-Forwarded-For.
 * Falls back to Express's req.ip then req.socket.remoteAddress.
 */
export function getClientIp(req: Request, trustProxy: boolean): string {
    if (trustProxy) {
        const forwarded = req.headers['x-forwarded-for']
        if (typeof forwarded === 'string') {
            const firstIp = forwarded.split(',')[0]?.trim()
            if (firstIp) return firstIp
        }
    }
    return req.ip ?? req.socket.remoteAddress ?? 'unknown'
}

// =============================================================================
// Rate Limiting
// =============================================================================

/**
 * Check rate limit for a request.
 * Returns object with `allowed` flag and optional `retryAfterSeconds`.
 */
export function checkRateLimit(
    req: Request,
    config: HttpTransportConfig,
    rateLimitMap: Map<string, RateLimitEntry>,
): { allowed: boolean; retryAfterSeconds?: number } {
    if (config.enableRateLimit === false) {
        return { allowed: true }
    }

    const clientIp = getClientIp(req, config.trustProxy ?? false)
    const now = Date.now()
    const windowMs = config.rateLimitWindowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS
    const maxRequests =
        config.rateLimitMaxRequests ??
        (process.env['MCP_RATE_LIMIT_MAX']
            ? parseInt(process.env['MCP_RATE_LIMIT_MAX'], 10)
            : DEFAULT_RATE_LIMIT_MAX_REQUESTS)

    const entry = rateLimitMap.get(clientIp)

    if (!entry || now > entry.resetTime) {
        rateLimitMap.set(clientIp, { count: 1, resetTime: now + windowMs })
        return { allowed: true }
    }

    if (entry.count >= maxRequests) {
        const retryAfterSeconds = Math.ceil((entry.resetTime - now) / 1000)
        return { allowed: false, retryAfterSeconds }
    }

    entry.count++
    return { allowed: true }
}

// =============================================================================
// Security Headers
// =============================================================================

/**
 * Set security headers for all responses.
 *
 * Headers: X-Content-Type-Options, X-Frame-Options, Cache-Control,
 * Content-Security-Policy, Permissions-Policy, Referrer-Policy, HSTS (opt-in).
 */
export function setSecurityHeaders(res: Response, config: HttpTransportConfig): void {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    res.setHeader('Referrer-Policy', 'no-referrer')

    if (config.enableHSTS) {
        const maxAge = config.hstsMaxAge ?? DEFAULT_HSTS_MAX_AGE
        res.setHeader('Strict-Transport-Security', `max-age=${String(maxAge)}; includeSubDomains`)
    }
}

// =============================================================================
// CORS
// =============================================================================

/**
 * Check if an origin matches a CORS pattern.
 * Supports exact match and wildcard subdomain patterns (e.g., `*.example.com`).
 */
export function matchesCorsOrigin(origin: string, pattern: string): boolean {
    if (pattern === '*') return true
    if (pattern.startsWith('*.')) {
        // Wildcard subdomain: "*.example.com" → ".example.com"
        const domain = pattern.slice(1) // ".example.com"
        return origin.endsWith(domain) && origin.length > domain.length
    }
    return origin === pattern
}

/**
 * Validate a request origin against the CORS whitelist.
 * Returns { origin, isExactMatch } where:
 * - origin: the validated origin string to use in the header
 * - isExactMatch: true if the origin matched an exact (non-wildcard) pattern
 *
 * For exact matches, returns the whitelist pattern itself (not user input)
 * to break taint tracking. For wildcard matches, returns the normalized origin.
 */
function getAllowedCorsOrigin(
    req: Request,
    corsOrigins: string[],
): { origin: string; isExactMatch: boolean } | null {
    const originHeader = req.headers?.origin
    if (!originHeader) return null
    if (originHeader === 'null') return null

    let url: URL
    try {
        url = new URL(originHeader)
    } catch {
        return null
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return null
    }

    const normalizedOrigin = `${url.protocol}//${url.host}`

    for (const pattern of corsOrigins) {
        if (matchesCorsOrigin(normalizedOrigin, pattern)) {
            if (!pattern.startsWith('*.')) {
                // Exact match: return the whitelist value (untainted by user input)
                return { origin: pattern, isExactMatch: true }
            }
            // Wildcard subdomain match: must echo the specific origin
            return { origin: normalizedOrigin, isExactMatch: false }
        }
    }

    return null
}

/**
 * Set CORS headers based on configuration.
 * When credentials are enabled, the origin is validated and normalized
 * via URL parsing to prevent CORS misconfiguration attacks.
 *
 * For exact whitelist matches, the header value comes directly from the
 * config (not user input). For wildcard subdomain matches, credentials
 * are not set to prevent tainted origin + credentials combinations.
 */
export function setCorsHeaders(req: Request, res: Response, config: HttpTransportConfig): void {
    const corsOrigins = config.corsOrigins ?? ['*']
    const isWildcard = corsOrigins.includes('*')

    if (isWildcard) {
        res.setHeader('Access-Control-Allow-Origin', '*')
        // Never set Allow-Credentials with wildcard origin
    } else {
        const match = getAllowedCorsOrigin(req, corsOrigins)
        if (!match) {
            return
        }
        res.setHeader('Access-Control-Allow-Origin', match.origin)
        res.setHeader('Vary', 'Origin')
        // Only set credentials for exact whitelist matches (not wildcard-derived origins)
        // This ensures the Allow-Origin value is never tainted by user input when credentials are enabled
        if (config.corsAllowCredentials && match.isExactMatch) {
            res.setHeader('Access-Control-Allow-Credentials', 'true')
        }
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Accept, Authorization, mcp-session-id, Last-Event-ID, mcp-protocol-version',
    )
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id')
    res.setHeader('Access-Control-Max-Age', '86400')
}

