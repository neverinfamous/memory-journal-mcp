/**
 * memory-journal-mcp — HTTP Transport Types
 *
 * Shared interfaces and constants for the HTTP transport module.
 */

// =============================================================================
// Server Timeout Constants
// =============================================================================

/** HTTP request timeout (ms) — prevents slowloris-style DoS */
export const HTTP_REQUEST_TIMEOUT_MS = 120_000

/** Keep-alive timeout (ms) — slightly above common LB idle timeout */
export const HTTP_KEEP_ALIVE_TIMEOUT_MS = 65_000

/** Headers timeout (ms) — must be > keepAliveTimeout per Node.js docs */
export const HTTP_HEADERS_TIMEOUT_MS = 66_000

// =============================================================================
// Rate Limiting Constants
// =============================================================================

export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000
export const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 100
export const DEFAULT_MAX_BODY_BYTES = 1_048_576 // 1 MB
export const DEFAULT_HSTS_MAX_AGE = 31_536_000 // 1 year

/** CORS preflight cache duration (seconds) — browsers cache OPTIONS responses for 24h */
export const CORS_PREFLIGHT_MAX_AGE_SECONDS = 86_400

// =============================================================================
// Session Timing
// =============================================================================

/** Session timeout for stateful HTTP mode (30 minutes) */
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000

/** Session timeout sweep interval (1 minute) */
export const SESSION_SWEEP_INTERVAL_MS = 1 * 60 * 1000

// =============================================================================
// Rate Limiting
// =============================================================================

export interface RateLimitEntry {
    count: number
    resetTime: number
    lastSeen: number
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * HTTP transport configuration
 */
export interface HttpTransportConfig {
    /** Port to listen on */
    port: number

    /** Host to bind to (default: localhost) */
    host: string

    /** Enable stateless HTTP mode (default: false) */
    stateless: boolean

    /** Bearer token for authentication (optional) */
    authToken?: string | undefined

    /**
     * Allowed CORS origins. Defaults to `[]` (no origins allowed — strict by default).
     * To allow all origins, pass `["*"]`. For production, list explicit origins.
     * Note: `corsAllowCredentials` cannot be combined with the `"*"` wildcard.
     */
    corsOrigins?: string[] | undefined

    /** Allow credentials in CORS requests (default: false) */
    corsAllowCredentials?: boolean | undefined

    /**
     * Trust proxy headers for client IP extraction (default: false).
     * When enabled, uses the leftmost IP from X-Forwarded-For for rate limiting.
     * Only enable when running behind a trusted reverse proxy.
     */
    trustProxy?: boolean | undefined

    /**
     * Enable HTTP Strict Transport Security header (default: false).
     * Should only be enabled when running behind HTTPS.
     */
    enableHSTS?: boolean | undefined

    /** HSTS max-age in seconds (default: 31536000 = 1 year) */
    hstsMaxAge?: number | undefined

    /** Enable rate limiting (default: true) */
    enableRateLimit?: boolean | undefined

    /** Rate limit window in milliseconds (default: 60000 = 1 minute) */
    rateLimitWindowMs?: number | undefined

    /** Maximum requests per window per IP (default: 100) */
    rateLimitMaxRequests?: number | undefined

    /** Maximum request body size in bytes (default: 1MB) */
    maxBodySize?: number | undefined

    // =================
    // OAuth 2.1 Config
    // =================

    /** Enable OAuth 2.1 authentication (default: false) */
    oauthEnabled?: boolean | undefined

    /** OAuth issuer URL (authorization server) */
    oauthIssuer?: string | undefined

    /** Expected OAuth audience (client ID) */
    oauthAudience?: string | undefined

    /** JWKS URI for key discovery (auto-discovered if not set) */
    oauthJwksUri?: string | undefined

    /** Clock tolerance in seconds for token validation (default: 60) */
    oauthClockTolerance?: number | undefined

    /**
     * The public resource origin for OAuth RFC 9728 metadata (e.g. "https://example.com").
     * If omitted, falls back to the dynamic http://${host}:${port}.
     */
    publicOrigin?: string | undefined

    /**
     * Explicit flag to allow plaintext (http://) loopback URLs for OAuth operations.
     * Prevents accidental deployment of insecure issuers.
     */
    allowPlaintextLoopbackOAuth?: boolean | undefined

    /** Metrics export format. When set to 'prometheus', exposes GET /metrics endpoint. */
    metricsExport?: 'prometheus' | undefined
}
