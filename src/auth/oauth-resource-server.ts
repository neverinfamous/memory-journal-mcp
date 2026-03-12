/**
 * memory-journal-mcp — OAuth Protected Resource Server (RFC 9728)
 *
 * Implements the OAuth 2.0 Protected Resource Metadata endpoint
 * as specified in RFC 9728.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc9728
 */

import type { RequestHandler } from 'express'
import type { ProtectedResourceMetadata, ResourceServerConfig } from './types.js'
import { SUPPORTED_SCOPES, BASE_SCOPES } from './scopes.js'
import { logger } from '../utils/logger.js'

// =============================================================================
// OAuth Resource Server
// =============================================================================

/**
 * OAuth 2.0 Protected Resource Server
 *
 * Provides Protected Resource Metadata (RFC 9728) for MCP authorization.
 */
export class OAuthResourceServer {
    private readonly config: Required<ResourceServerConfig>
    private metadata: ProtectedResourceMetadata | null = null

    constructor(config: ResourceServerConfig) {
        this.config = {
            resource: config.resource,
            authorizationServers: config.authorizationServers,
            scopesSupported:
                config.scopesSupported.length > 0 ? config.scopesSupported : [...SUPPORTED_SCOPES],
            bearerMethodsSupported: config.bearerMethodsSupported ?? ['header'],
        }

        logger.info(`OAuth Resource Server initialized for: ${this.config.resource}`, {
            module: 'AUTH',
            operation: 'init',
        })
    }

    /**
     * Get the Protected Resource Metadata document
     *
     * @returns RFC 9728 compliant metadata
     */
    getMetadata(): ProtectedResourceMetadata {
        this.metadata ??= this.buildMetadata()
        return this.metadata
    }

    /**
     * Build the Protected Resource Metadata document
     */
    private buildMetadata(): ProtectedResourceMetadata {
        return {
            resource: this.config.resource,
            authorization_servers: this.config.authorizationServers,
            scopes_supported: this.config.scopesSupported,
            bearer_methods_supported: this.config.bearerMethodsSupported,
            resource_documentation: `${this.config.resource}/docs`,
            resource_signing_alg_values_supported: ['RS256', 'ES256'],
        }
    }

    /**
     * Get Express request handler for the metadata endpoint
     *
     * Serves: GET /.well-known/oauth-protected-resource
     */
    getMetadataHandler(): RequestHandler {
        return (_req, res) => {
            const metadata = this.getMetadata()

            res.setHeader('Content-Type', 'application/json')
            res.setHeader('Cache-Control', 'public, max-age=3600')
            res.json(metadata)

            logger.info('Protected Resource Metadata served', {
                module: 'AUTH',
                operation: 'metadata-served',
            })
        }
    }

    /**
     * Generate WWW-Authenticate header for 401 responses
     *
     * @param error - Error type for the header
     * @param errorDescription - Human-readable error description
     * @returns WWW-Authenticate header value
     */
    getWWWAuthenticateHeader(error?: string, errorDescription?: string): string {
        const parts = [`Bearer realm="${this.config.resource}"`]

        if (error) {
            parts.push(`error="${error}"`)
        }

        if (errorDescription) {
            parts.push(`error_description="${errorDescription}"`)
        }

        return parts.join(', ')
    }

    /**
     * Get the resource URI
     */
    getResourceUri(): string {
        return this.config.resource
    }

    /**
     * Get the authorization servers
     */
    getAuthorizationServers(): string[] {
        return [...this.config.authorizationServers]
    }

    /**
     * Get supported scopes
     */
    getSupportedScopes(): string[] {
        return [...this.config.scopesSupported]
    }

    /**
     * Check if a scope is supported by this resource server.
     */
    isScopeSupported(scope: string): boolean {
        // Check standard base scopes
        if ((BASE_SCOPES as readonly string[]).includes(scope)) {
            return true
        }

        // Check configured scopes
        if (this.config.scopesSupported.includes(scope)) {
            return true
        }

        return false
    }

    /**
     * Get the well-known metadata endpoint path
     */
    getWellKnownPath(): string {
        return '/.well-known/oauth-protected-resource'
    }

    /**
     * Clear cached metadata (useful when configuration changes)
     */
    clearCache(): void {
        this.metadata = null
    }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an OAuth Resource Server instance
 */
export function createOAuthResourceServer(config: ResourceServerConfig): OAuthResourceServer {
    return new OAuthResourceServer(config)
}
