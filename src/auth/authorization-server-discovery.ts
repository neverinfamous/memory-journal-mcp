/**
 * memory-journal-mcp — Authorization Server Discovery (RFC 8414)
 *
 * Discovers and caches OAuth 2.0 Authorization Server Metadata
 * as specified in RFC 8414.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc8414
 */

import type { AuthorizationServerMetadata, AuthServerDiscoveryConfig } from './types.js'
import { AuthServerDiscoveryError } from './errors.js'
import { ConfigurationError } from '../types/errors.js'
import { logger } from '../utils/logger.js'
import { resolveSafePublicDnsAddresses } from './jwks-ssrf-guard.js'
import { fetchDiscoveryMetadata } from './discovery-fetch-helpers.js'
import { isPrivateOrLoopbackAddress } from '../utils/network-safety.js'

function parseDiscoveryUrl(metadataUrl: string): URL {
    let parsedUrl: URL
    try {
        parsedUrl = new URL(metadataUrl)
    } catch {
        throw new ConfigurationError(`Invalid authorization server URL: ${metadataUrl}`)
    }
    if (parsedUrl.protocol !== 'https:') {
        throw new ConfigurationError(`Authorization server URL must use HTTPS: ${metadataUrl}`)
    }
    if (parsedUrl.username !== '' || parsedUrl.password !== '') {
        throw new ConfigurationError(
            `Authorization server URL must not contain credentials: ${parsedUrl.origin}`
        )
    }
    return parsedUrl
}

// =============================================================================
// Authorization Server Discovery
// =============================================================================

/**
 * Authorization Server Metadata Discovery
 *
 * Fetches and caches OAuth 2.0 authorization server metadata
 * from the /.well-known/oauth-authorization-server endpoint.
 */
export class AuthorizationServerDiscovery {
    private readonly authServerUrl: string
    private readonly cacheTtl: number
    private readonly timeout: number

    private cachedMetadata: AuthorizationServerMetadata | null = null
    private cacheExpiry = 0

    constructor(config: AuthServerDiscoveryConfig) {
        // Normalize URL (remove trailing slash)
        this.authServerUrl = config.authServerUrl.replace(/\/+$/, '')
        this.cacheTtl = config.cacheTtl ?? 3600
        this.timeout = config.timeout ?? 5000

        logger.info(`Authorization Server Discovery initialized for: ${this.authServerUrl}`, {
            module: 'AUTH',
            operation: 'init',
        })
    }

    /**
     * Discover authorization server metadata
     *
     * Fetches from /.well-known/oauth-authorization-server
     * Results are cached for cacheTtl seconds.
     *
     * @returns Authorization server metadata
     * @throws AuthServerDiscoveryError if discovery fails
     */
    async discover(): Promise<AuthorizationServerMetadata> {
        if (this.cachedMetadata && Date.now() < this.cacheExpiry) {
            logger.info('Using cached authorization server metadata', {
                module: 'AUTH',
                operation: 'cache-hit',
            })
            return this.cachedMetadata
        }

        const metadataUrl = `${this.authServerUrl}/.well-known/oauth-authorization-server`
        const parsedUrl = parseDiscoveryUrl(metadataUrl)
        const resolvedRecords = await resolveSafePublicDnsAddresses(
            parsedUrl.hostname.toLowerCase(),
            'authorization server'
        )

        logger.info(`Fetching authorization server metadata from: ${metadataUrl}`, {
            module: 'AUTH',
            operation: 'discovery',
        })

        try {
            const metadata = await fetchDiscoveryMetadata(
                metadataUrl,
                parsedUrl.host,
                resolvedRecords,
                this.timeout
            )
            this.validateMetadata(metadata)
            this.cachedMetadata = metadata
            this.cacheExpiry = Date.now() + this.cacheTtl * 1000

            logger.info(`Authorization server metadata cached for ${String(this.cacheTtl)}s`, {
                module: 'AUTH',
                operation: 'discovery-success',
            })

            return metadata
        } catch (error) {
            if (error instanceof AuthServerDiscoveryError) {
                throw error
            }
            const cause = error instanceof Error ? error : new Error(String(error))
            logger.error(`Failed to discover authorization server: ${this.authServerUrl}`, {
                module: 'AUTH',
                operation: 'discovery',
                error: cause.message,
            })
            throw new AuthServerDiscoveryError(this.authServerUrl, cause)
        }
    }

    /**
     * Validate required metadata fields per RFC 8414
     */
    private assertSafeHttpsMetadataEndpoint(rawUrl: string, fieldName: string): void {
        let parsed: URL
        try {
            parsed = new URL(rawUrl)
        } catch {
            throw new ConfigurationError(`Invalid ${fieldName} URL in authorization server metadata`)
        }
        if (parsed.protocol !== 'https:') {
            throw new ConfigurationError(`Metadata field '${fieldName}' must use https:`)
        }
        if (parsed.username !== '' || parsed.password !== '') {
            throw new ConfigurationError(`Metadata field '${fieldName}' must not contain credentials`)
        }
        const normalizedHost = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase()
        if (
            normalizedHost === '' ||
            normalizedHost === 'localhost' ||
            normalizedHost.endsWith('.localhost') ||
            normalizedHost.endsWith('.local') ||
            normalizedHost.endsWith('.internal') ||
            isPrivateOrLoopbackAddress(normalizedHost)
        ) {
            throw new ConfigurationError(
                `Metadata field '${fieldName}' resolves to restricted network address: ${normalizedHost}`
            )
        }
    }

    private validateMetadata(metadata: AuthorizationServerMetadata): void {
        if (!metadata.issuer) {
            throw new ConfigurationError('Missing required field: issuer')
        }

        if (!metadata.token_endpoint) {
            throw new ConfigurationError('Missing required field: token_endpoint')
        }

        this.assertSafeHttpsMetadataEndpoint(metadata.issuer, 'issuer')
        this.assertSafeHttpsMetadataEndpoint(metadata.token_endpoint, 'token_endpoint')
        const optionalUrls: [string, string | undefined][] = [
            ['authorization_endpoint', metadata.authorization_endpoint],
            ['jwks_uri', metadata.jwks_uri],
            ['registration_endpoint', metadata.registration_endpoint],
            ['revocation_endpoint', metadata.revocation_endpoint],
            ['introspection_endpoint', metadata.introspection_endpoint],
        ]
        for (const [field, urlVal] of optionalUrls) {
            if (urlVal !== undefined) {
                this.assertSafeHttpsMetadataEndpoint(urlVal, field)
            }
        }

        // Validate issuer matches the expected URL
        // Per RFC 8414 §3.3, issuer MUST be identical to the authorization server URL
        const expectedIssuer = this.authServerUrl
        const actualIssuer = metadata.issuer.replace(/\/+$/, '')
        if (actualIssuer !== expectedIssuer) {
            throw new ConfigurationError(
                `Authorization server issuer mismatch: expected ${expectedIssuer}, got ${metadata.issuer}`
            )
        }
    }

    /**
     * Get cached metadata (throws if not discovered)
     */
    getMetadata(): AuthorizationServerMetadata {
        if (!this.cachedMetadata) {
            throw new ConfigurationError(
                'Authorization server metadata not yet discovered. Call discover() first.'
            )
        }
        return this.cachedMetadata
    }

    /**
     * Get JWKS URI from metadata
     *
     * @throws Error if metadata not discovered or jwks_uri not present
     */
    getJwksUri(): string {
        const metadata = this.getMetadata()

        if (!metadata.jwks_uri) {
            throw new ConfigurationError('Authorization server does not provide jwks_uri')
        }

        return metadata.jwks_uri
    }

    /**
     * Get token endpoint from metadata
     */
    getTokenEndpoint(): string {
        return this.getMetadata().token_endpoint
    }

    /**
     * Get issuer from metadata
     */
    getIssuer(): string {
        return this.getMetadata().issuer
    }

    /**
     * Get registration endpoint from metadata (RFC 7591)
     *
     * @returns Registration endpoint or null if not supported
     */
    getRegistrationEndpoint(): string | null {
        return this.getMetadata().registration_endpoint ?? null
    }

    /**
     * Check if dynamic client registration is supported
     */
    supportsClientRegistration(): boolean {
        return this.getRegistrationEndpoint() !== null
    }

    /**
     * Get supported scopes from metadata
     */
    getSupportedScopes(): string[] {
        return this.getMetadata().scopes_supported ?? []
    }

    /**
     * Check if a specific scope is supported
     */
    isScopeSupported(scope: string): boolean {
        const supportedScopes = this.getSupportedScopes()
        // If no scopes are listed, assume all scopes are supported
        return supportedScopes.length === 0 || supportedScopes.includes(scope)
    }

    /**
     * Clear cached metadata
     */
    clearCache(): void {
        this.cachedMetadata = null
        this.cacheExpiry = 0
        logger.info('Authorization server metadata cache cleared', {
            module: 'AUTH',
            operation: 'cache-clear',
        })
    }

    /**
     * Check if cache is valid
     */
    isCacheValid(): boolean {
        return this.cachedMetadata !== null && Date.now() < this.cacheExpiry
    }

    /**
     * Get the authorization server URL
     */
    getAuthServerUrl(): string {
        return this.authServerUrl
    }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an Authorization Server Discovery instance
 */
export function createAuthServerDiscovery(
    authServerUrl: string,
    options?: Partial<Omit<AuthServerDiscoveryConfig, 'authServerUrl'>>
): AuthorizationServerDiscovery {
    return new AuthorizationServerDiscovery({
        authServerUrl,
        cacheTtl: options?.cacheTtl,
        timeout: options?.timeout,
    })
}
