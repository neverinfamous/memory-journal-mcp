/**
 * memory-journal-mcp — OAuth Types
 *
 * Type definitions for OAuth 2.0 components including
 * RFC 9728, RFC 8414, and RFC 7591 compliance.
 */

// =============================================================================
// RFC 9728 - Protected Resource Metadata
// =============================================================================

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728)
 *
 * @see https://datatracker.ietf.org/doc/html/rfc9728
 */
export interface ProtectedResourceMetadata {
    /** Resource identifier (canonical URI) */
    resource: string

    /** Authorization servers that can issue tokens for this resource */
    authorization_servers?: string[]

    /** JWKS URI for token verification (optional, usually from auth server) */
    jwks_uri?: string

    /** Scopes supported by this resource */
    scopes_supported?: string[]

    /** Bearer token presentation methods supported */
    bearer_methods_supported?: ('header' | 'body' | 'query')[]

    /** Resource signing algorithms supported */
    resource_signing_alg_values_supported?: string[]

    /** Resource documentation URL */
    resource_documentation?: string

    /** Resource policy URI */
    resource_policy_uri?: string

    /** Resource terms of service URI */
    resource_tos_uri?: string
}

// =============================================================================
// RFC 8414 - Authorization Server Metadata
// =============================================================================

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 *
 * @see https://datatracker.ietf.org/doc/html/rfc8414
 */
export interface AuthorizationServerMetadata {
    /** Authorization server issuer identifier */
    issuer: string

    /** Authorization endpoint URL */
    authorization_endpoint?: string

    /** Token endpoint URL */
    token_endpoint: string

    /** JWKS URI */
    jwks_uri?: string

    /** Registration endpoint (RFC 7591) */
    registration_endpoint?: string

    /** Scopes supported */
    scopes_supported?: string[]

    /** Response types supported */
    response_types_supported?: string[]

    /** Response modes supported */
    response_modes_supported?: string[]

    /** Grant types supported */
    grant_types_supported?: string[]

    /** Token endpoint auth methods supported */
    token_endpoint_auth_methods_supported?: string[]

    /** Token endpoint auth signing algorithms */
    token_endpoint_auth_signing_alg_values_supported?: string[]

    /** Service documentation URL */
    service_documentation?: string

    /** UI locales supported */
    ui_locales_supported?: string[]

    /** OP policy URI */
    op_policy_uri?: string

    /** OP terms of service URI */
    op_tos_uri?: string

    /** Revocation endpoint */
    revocation_endpoint?: string

    /** Revocation endpoint auth methods */
    revocation_endpoint_auth_methods_supported?: string[]

    /** Introspection endpoint */
    introspection_endpoint?: string

    /** Introspection endpoint auth methods */
    introspection_endpoint_auth_methods_supported?: string[]

    /** Code challenge methods supported (PKCE) */
    code_challenge_methods_supported?: string[]
}

// =============================================================================
// RFC 7591 - Dynamic Client Registration
// =============================================================================

/**
 * OAuth 2.0 Dynamic Client Registration Request (RFC 7591)
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7591
 */
export interface ClientRegistrationRequest {
    /** Redirect URIs */
    redirect_uris?: string[]

    /** Token endpoint auth method */
    token_endpoint_auth_method?: string

    /** Grant types requested */
    grant_types?: string[]

    /** Response types requested */
    response_types?: string[]

    /** Client name */
    client_name?: string

    /** Client URI */
    client_uri?: string

    /** Logo URI */
    logo_uri?: string

    /** Scopes requested */
    scope?: string

    /** Contacts */
    contacts?: string[]

    /** Terms of service URI */
    tos_uri?: string

    /** Policy URI */
    policy_uri?: string

    /** JWKS URI for client authentication */
    jwks_uri?: string

    /** JWKS document for client authentication */
    jwks?: JWKSDocument

    /** Software ID */
    software_id?: string

    /** Software version */
    software_version?: string

    /** Software statement (signed JWT) */
    software_statement?: string
}

/**
 * OAuth 2.0 Dynamic Client Registration Response (RFC 7591)
 */
export interface ClientRegistrationResponse {
    /** Client identifier */
    client_id: string

    /** Client secret (for confidential clients) */
    client_secret?: string

    /** Client secret expiration timestamp */
    client_secret_expires_at?: number

    /** Registration access token */
    registration_access_token?: string

    /** Registration client URI */
    registration_client_uri?: string

    /** Client ID issued at timestamp */
    client_id_issued_at?: number

    /** All other fields from the request */
    [key: string]: unknown
}

// =============================================================================
// JWKS Types
// =============================================================================

/**
 * JSON Web Key (JWK)
 */
export interface JWK {
    /** Key type (e.g., 'RSA', 'EC') */
    kty: string

    /** Key use ('sig' for signature, 'enc' for encryption) */
    use?: string

    /** Key operations */
    key_ops?: string[]

    /** Algorithm */
    alg?: string

    /** Key ID */
    kid?: string

    /** X.509 URL */
    x5u?: string

    /** X.509 certificate chain */
    x5c?: string[]

    /** X.509 certificate SHA-1 thumbprint */
    x5t?: string

    /** X.509 certificate SHA-256 thumbprint */
    'x5t#S256'?: string

    // RSA-specific fields
    /** RSA modulus */
    n?: string
    /** RSA public exponent */
    e?: string

    // EC-specific fields
    /** EC curve */
    crv?: string
    /** EC x coordinate */
    x?: string
    /** EC y coordinate */
    y?: string
}

/**
 * JSON Web Key Set (JWKS)
 */
export interface JWKSDocument {
    /** Array of JWK keys */
    keys: JWK[]
}

// =============================================================================
// Token Validation Types
// =============================================================================

/**
 * Result of token validation
 */
export interface TokenValidationResult {
    /** Whether the token is valid */
    valid: boolean

    /** Validated claims (if valid) */
    claims?: TokenClaims

    /** Error message (if invalid) */
    error?: string

    /** Error code (if invalid) */
    errorCode?: string
}

/**
 * Validated token claims
 */
export interface TokenClaims {
    /** Subject (user ID) */
    sub: string

    /** Granted scopes (parsed from space-delimited string) */
    scopes: string[]

    /** Token expiration time (Unix timestamp) */
    exp: number

    /** Token issued at time (Unix timestamp) */
    iat: number

    /** Token issuer */
    iss?: string | undefined

    /** Token audience */
    aud?: string | string[] | undefined

    /** Not before time (Unix timestamp) */
    nbf?: number | undefined

    /** JWT ID */
    jti?: string | undefined

    /** Client ID */
    client_id?: string | undefined

    /** Additional claims */
    [key: string]: unknown
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Resource server configuration
 */
export interface ResourceServerConfig {
    /** Resource identifier (canonical server URI) */
    resource: string

    /** Authorization servers that can issue tokens */
    authorizationServers: string[]

    /** Scopes supported by this resource */
    scopesSupported: string[]

    /** Bearer token methods accepted (default: ['header']) */
    bearerMethodsSupported?: ('header' | 'body' | 'query')[]
}

/**
 * Token validator configuration
 */
export interface TokenValidatorConfig {
    /** JWKS URI for key discovery */
    jwksUri: string

    /** Expected issuer */
    issuer: string

    /** Expected audience */
    audience: string

    /** Clock tolerance in seconds (default: 60) */
    clockTolerance?: number | undefined

    /** JWKS cache TTL in seconds (default: 3600) */
    jwksCacheTtl?: number | undefined

    /** Supported algorithms (default: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512']) */
    algorithms?: string[] | undefined
}

/**
 * Authorization server discovery configuration
 */
export interface AuthServerDiscoveryConfig {
    /** Authorization server URL (issuer) */
    authServerUrl: string

    /** Cache TTL in seconds (default: 3600) */
    cacheTtl?: number | undefined

    /** Request timeout in milliseconds (default: 5000) */
    timeout?: number | undefined
}
