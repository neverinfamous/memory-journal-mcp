/**
 * memory-journal-mcp — HTTP Transport Security
 *
 * Security utilities: rate limiting, headers, CORS, client IP extraction.
 */

import type { Request, Response } from 'express'
import { createHash } from 'node:crypto'
import { parseCanonicalPositiveInt } from '../../utils/safe-positive-int.js'
import type { HttpTransportConfig, RateLimitEntry } from './types.js'
import {
    DEFAULT_RATE_LIMIT_WINDOW_MS,
    DEFAULT_RATE_LIMIT_MAX_REQUESTS,
    DEFAULT_HSTS_MAX_AGE,
    CORS_PREFLIGHT_MAX_AGE_SECONDS,
} from './types.js'

// =============================================================================
// Client IP Extraction
// =============================================================================

/**
 * Extract the client IP address from the request.
 * Note: req.ip correctly respects proxy boundaries because
 * `this.app.set('trust proxy', 'loopback')` is configured globally in the HTTP server
 * when `trustProxy` is enabled. This prevents client IP spoofing while supporting reverse proxies.
 * Falls back to req.socket.remoteAddress if req.ip is not available.
 */
export function getClientIp(req: Request): string {
    return req.ip ?? req.socket.remoteAddress ?? 'unknown'
}

// =============================================================================
// Rate Limiting
// =============================================================================

/**
 * Rate-limit key. The limiter runs before authentication, so this hashes the
 * raw Bearer token when one is present and otherwise hashes the client IP.
 * It does not read JWT claims. NOTE: `checkRateLimit` deliberately passes no
 * authorization header, so buckets are keyed on client IP only (an unauthenticated
 * caller could otherwise mint unlimited buckets by rotating fake tokens).
 */
const BEARER_PREFIX_RE = /^Bearer\s+(\S+)/i
const MAX_IP_DIGEST_CACHE = 1024
const IP_DIGEST_CACHE = new Map<string, string>()
let cachedRateLimitEnvRaw: string | undefined
let cachedRateLimitEnvMax = DEFAULT_RATE_LIMIT_MAX_REQUESTS

function getEnvRateLimitMax(): number {
    const raw = process.env['MCP_RATE_LIMIT_MAX']
    if (raw !== cachedRateLimitEnvRaw) {
        cachedRateLimitEnvRaw = raw
        const parsed = raw !== undefined ? parseCanonicalPositiveInt(raw) : undefined
        cachedRateLimitEnvMax = parsed ?? DEFAULT_RATE_LIMIT_MAX_REQUESTS
    }
    return cachedRateLimitEnvMax
}

function getCachedIpDigest(clientIp: string): string {
    const cached = IP_DIGEST_CACHE.get(clientIp)
    if (cached !== undefined) {
        IP_DIGEST_CACHE.delete(clientIp)
        IP_DIGEST_CACHE.set(clientIp, cached)
        return cached
    }
    const digest = createHash('sha256').update(clientIp).digest('hex')
    if (IP_DIGEST_CACHE.size >= MAX_IP_DIGEST_CACHE) {
        const oldest = IP_DIGEST_CACHE.keys().next().value
        if (oldest !== undefined) IP_DIGEST_CACHE.delete(oldest)
    }
    IP_DIGEST_CACHE.set(clientIp, digest)
    return digest
}

export function rateLimitIdentity(authorization: string | undefined, clientIp: string): string {
    if (authorization !== undefined) {
        const match = BEARER_PREFIX_RE.exec(authorization.trim())
        const token = match?.[1]
        if (token !== undefined && token.length > 0) {
            return createHash('sha256').update(token).digest('hex')
        }
    }
    return getCachedIpDigest(clientIp)
}

/**
 * Check rate limit for a request.
 * Returns object with `allowed` flag and optional `retryAfterSeconds`.
 */
export function checkRateLimit(
    req: Request,
    config: HttpTransportConfig,
    rateLimitMap: Map<string, RateLimitEntry>
): { allowed: boolean; retryAfterSeconds?: number } {
    if (config.enableRateLimit === false) {
        return { allowed: true }
    }

    // Key on client IP only: this runs before authentication, so keying on the raw
    // bearer token would let rotating fake tokens mint unlimited buckets.
    const clientIdentity = rateLimitIdentity(undefined, getClientIp(req))
    const now = Date.now()
    const windowMs = config.rateLimitWindowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS
    const maxRequests = config.rateLimitMaxRequests ?? getEnvRateLimitMax()

    const entry = rateLimitMap.get(clientIdentity)

    if (!entry || now > entry.resetTime) {
        // Enforce hard cap to prevent Map OOM from unbounded IP spoofing
        if (rateLimitMap.size >= 10000 && !rateLimitMap.has(clientIdentity)) {
            // Cleanup expired entries first
            for (const [key, val] of rateLimitMap.entries()) {
                if (now > val.resetTime) {
                    rateLimitMap.delete(key)
                }
            }
            // If still at capacity, evict the oldest entry (LRU) to prevent fail-closed DoS.
            // Since JS Map preserves insertion order and we re-insert on access, the first item is the LRU.
            if (rateLimitMap.size >= 10000) {
                const firstKey = rateLimitMap.keys().next().value
                if (firstKey !== undefined) {
                    rateLimitMap.delete(firstKey)
                }
            }
        }
        rateLimitMap.set(clientIdentity, { count: 1, resetTime: now + windowMs, lastSeen: now })
        return { allowed: true }
    }

    entry.lastSeen = now

    // Re-insert to maintain LRU order (O(1))
    rateLimitMap.delete(clientIdentity)
    rateLimitMap.set(clientIdentity, entry)

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

/** True when a hostname/bind host refers to a loopback interface. */
export function isLoopbackHost(host: string): boolean {
    const normalized = host.trim().toLowerCase()
    return (
        normalized === 'localhost' ||
        normalized === '127.0.0.1' ||
        normalized === '::1' ||
        normalized === '[::1]'
    )
}

/** Brackets bare IPv6 literals for safe URL interpolation. */
export function formatHostForUrl(host: string): string {
    return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

/**
 * Set CORS headers based on configuration.
 *
 * Uses the `origin in whitelist` pattern from CodeQL's documented safe example
 * for js/cors-misconfiguration-for-credentials. CodeQL only recognizes specific
 * sanitizer expressions (object property lookup via `in`, `Set.has()`, etc.) —
 * `Array.some()` with a callback is NOT recognized as a sanitizer.
 *
 * Wildcard subdomain patterns (`*.example.com`) are not supported when
 * `corsAllowCredentials` is true. For credentialed CORS, list explicit origins.
 */
interface CachedCorsPolicy {
    originsRef: readonly string[] | undefined
    originsLen: number
    isLocalhost: boolean
    hasAuth: boolean
    isWildcard: boolean
    whitelist: Record<string, true>
}

const CORS_POLICY_CACHE = new WeakMap<HttpTransportConfig, CachedCorsPolicy>()

function getCachedCorsPolicy(config: HttpTransportConfig): CachedCorsPolicy {
    const originsRef = config.corsOrigins
    const originsLen = originsRef?.length ?? 0
    const isLocalhost = isLoopbackHost(config.host ?? '')
    const hasAuth = Boolean(config.authToken) || config.oauthEnabled === true
    const cached = CORS_POLICY_CACHE.get(config)
    if (
        cached !== undefined &&
        cached.originsRef === originsRef &&
        cached.originsLen === originsLen &&
        cached.isLocalhost === isLocalhost &&
        cached.hasAuth === hasAuth
    ) {
        return cached
    }

    let corsOrigins = originsRef ?? []
    // Hard-block wildcard CORS on localhost if no auth is configured to prevent local-browser CSRF
    if (isLocalhost && !hasAuth && corsOrigins.includes('*')) {
        corsOrigins = corsOrigins.filter((o) => o !== '*')
    }
    const isWildcard = corsOrigins.includes('*')
    const whitelist = Object.create(null) as Record<string, true>
    if (!isWildcard) {
        for (const allowed of corsOrigins) {
            whitelist[allowed] = true
        }
    }
    const next: CachedCorsPolicy = {
        originsRef,
        originsLen,
        isLocalhost,
        hasAuth,
        isWildcard,
        whitelist,
    }
    CORS_POLICY_CACHE.set(config, next)
    return next
}

export function setCorsHeaders(req: Request, res: Response, config: HttpTransportConfig): boolean {
    const policy = getCachedCorsPolicy(config)
    const { isWildcard, whitelist } = policy
    const origin = req.headers.origin
    let checkedWhitelist: Record<string, true> | undefined

    if (isWildcard) {
        res.setHeader('Access-Control-Allow-Origin', '*')
    } else if (origin) {
        // CodeQL recognizes `origin in whitelist` as a sanitizer
        checkedWhitelist = whitelist
        if (origin in checkedWhitelist) {
            res.setHeader('Access-Control-Allow-Origin', origin)
            res.setHeader('Vary', 'Origin')
            if (config.corsAllowCredentials) {
                res.setHeader('Access-Control-Allow-Credentials', 'true')
            }
        }
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Accept, Authorization, mcp-session-id, Last-Event-ID, mcp-protocol-version'
    )
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id')
    res.setHeader('Access-Control-Max-Age', String(CORS_PREFLIGHT_MAX_AGE_SECONDS))

    if (origin && !isWildcard && checkedWhitelist !== undefined) {
        if (!(origin in checkedWhitelist)) {
            // Self-origin fallback removed to prevent host header injection
            return false
        }
    }
    return true
}

function validateOAuthEndpointUrl(
    rawUrl: string,
    label: string,
    allowPlaintextLoopback: boolean,
    logError: (msg: string, meta?: Record<string, unknown>) => void
): void {
    let parsed: URL
    try {
        parsed = new URL(rawUrl)
    } catch {
        const errorMsg = `FATAL: OAuth ${label} is not a valid URL.`
        logError(errorMsg, { module: 'HTTP', operation: 'oauth-config' })
        throw new Error(errorMsg)
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        const errorMsg = `FATAL: OAuth ${label} uses unsupported protocol '${parsed.protocol}'.`
        logError(errorMsg, { module: 'HTTP', operation: 'oauth-config' })
        throw new Error(errorMsg)
    }
    if (parsed.protocol === 'http:') {
        if (!allowPlaintextLoopback) {
            const errorMsg = `FATAL: OAuth ${label} targets a plaintext protocol. You MUST deliberately set 'allowPlaintextLoopbackOAuth: true' in config to bypass strict discovery bound.`
            logError(errorMsg, { module: 'HTTP', operation: 'oauth-config' })
            throw new Error(errorMsg)
        }
        if (!isLoopbackHost(parsed.hostname)) {
            const errorMsg = `FATAL: Plaintext OAuth bypass is ONLY permitted for loopback hosts (localhost, 127.0.0.1, [::1]). The configured ${label} is not allowed.`
            logError(errorMsg, { module: 'HTTP', operation: 'oauth-config' })
            throw new Error(errorMsg)
        }
    }
}

/**
 * Validate OAuth transport settings (issuer, audience, plaintext loopback exception, publicOrigin).
 * Throws an Error after invoking `logError` when configuration is unsafe or incomplete.
 */
export function validateOAuthTransportConfig(
    config: HttpTransportConfig,
    host: string,
    isLocalhost: boolean,
    logError: (msg: string, meta?: Record<string, unknown>) => void
): { oauthIssuer: string; oauthAudience: string } | null {
    if (config.oauthEnabled !== true) {
        return null
    }
    if (config.oauthIssuer === undefined || config.oauthAudience === undefined) {
        const errorMsg = `FATAL: OAuth is enabled but 'oauthIssuer' and/or 'oauthAudience' is missing. Refusing to start without a complete OAuth configuration, because the server would otherwise run without authentication.`
        logError(errorMsg, { module: 'HTTP', operation: 'oauth-config' })
        throw new Error(errorMsg)
    }

    const allowPlaintext = config.allowPlaintextLoopbackOAuth === true
    validateOAuthEndpointUrl(config.oauthIssuer, 'issuer', allowPlaintext, logError)
    if (config.oauthJwksUri !== undefined && config.oauthJwksUri !== '') {
        validateOAuthEndpointUrl(config.oauthJwksUri, 'jwksUri', allowPlaintext, logError)
    }

    const rawPublicOrigin = config.publicOrigin
    const trimmedPublicOrigin = rawPublicOrigin?.trim()
    if (rawPublicOrigin !== undefined && rawPublicOrigin !== '' && trimmedPublicOrigin === '') {
        const errorMsg = `FATAL: 'publicOrigin' cannot be whitespace-only. Provide a valid http:// or https:// URL (e.g. 'https://api.example.com').`
        logError(errorMsg, { module: 'HTTP' })
        throw new Error(errorMsg)
    }

    if (!isLocalhost && (trimmedPublicOrigin === undefined || trimmedPublicOrigin === '')) {
        const errorMsg = `FATAL: OAuth is enabled on a non-loopback interface ('${host}'), but no 'publicOrigin' was provided. You MUST specify an explicit public origin (e.g. 'https://api.example.com') for secure OAuth token audience binding.`
        logError(errorMsg, { module: 'HTTP' })
        throw new Error(errorMsg)
    }

    return { oauthIssuer: config.oauthIssuer, oauthAudience: config.oauthAudience }
}

/**
 * Builds the allowlisted HTTP `Host` header entries for DNS rebinding protection,
 * including `publicOrigin` hostname and host[:port] when configured.
 */
export function buildAllowedHostHeaders(
    host: string,
    publicOrigin: string | undefined
): string[] {
    const normalizedHost = formatHostForUrl(host.trim().toLowerCase())
    const allowed = new Set<string>(['localhost', '127.0.0.1', '[::1]'])
    if (normalizedHost !== '') {
        allowed.add(normalizedHost)
    }
    if (publicOrigin !== undefined && publicOrigin.trim() !== '') {
        const trimmedOrigin = publicOrigin.trim()
        let parsed: URL
        try {
            parsed = new URL(trimmedOrigin)
        } catch (cause) {
            throw new Error(
                `Invalid publicOrigin '${trimmedOrigin}': expected a valid http:// or https:// URL.`,
                { cause }
            )
        }
        if (
            (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
            parsed.hostname === ''
        ) {
            throw new Error(
                `Invalid publicOrigin '${trimmedOrigin}': expected a valid http:// or https:// URL with a non-empty hostname.`
            )
        }
        allowed.add(parsed.hostname.toLowerCase())
        if (parsed.host !== '') allowed.add(parsed.host.toLowerCase())
    }
    return Array.from(allowed)
}
