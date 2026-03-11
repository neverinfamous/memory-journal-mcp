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

/** Session timeout for stateful HTTP mode (30 minutes) */
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000

/** Session timeout sweep interval (5 minutes) */
export const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000

// =============================================================================
// Rate Limiting
// =============================================================================

export interface RateLimitEntry {
    count: number
    resetTime: number
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
    authToken?: string

    /**
     * Allowed CORS origins. Defaults to ["*"] (all origins).
     * Supports wildcard subdomains (e.g., "*.example.com" matches "app.example.com").
     */
    corsOrigins?: string[]

    /** Allow credentials in CORS requests (default: false) */
    corsAllowCredentials?: boolean

    /**
     * Trust proxy headers for client IP extraction (default: false).
     * When enabled, uses the leftmost IP from X-Forwarded-For for rate limiting.
     * Only enable when running behind a trusted reverse proxy.
     */
    trustProxy?: boolean

    /**
     * Enable HTTP Strict Transport Security header (default: false).
     * Should only be enabled when running behind HTTPS.
     */
    enableHSTS?: boolean

    /** HSTS max-age in seconds (default: 31536000 = 1 year) */
    hstsMaxAge?: number

    /** Enable rate limiting (default: true) */
    enableRateLimit?: boolean

    /** Rate limit window in milliseconds (default: 60000 = 1 minute) */
    rateLimitWindowMs?: number

    /** Maximum requests per window per IP (default: 100) */
    rateLimitMaxRequests?: number

    /** Maximum request body size in bytes (default: 1MB) */
    maxBodySize?: number
}
