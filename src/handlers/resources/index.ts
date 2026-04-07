/**
 * Memory Journal MCP Server - Resource Handlers
 *
 * Barrel file composing resource definitions from sub-modules.
 * Exports all MCP resources with annotations following MCP 2025-11-25 spec.
 */

import type { VectorSearchManager } from '../../vector/vector-search-manager.js'
import type { ToolFilterConfig } from '../../filtering/tool-filter.js'
import type { GitHubIntegration } from '../../github/github-integration/index.js'
import type { Scheduler } from '../../server/scheduler.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { BriefingConfig } from './shared.js'

// Re-export shared types
export type { ResourceContext, ResourceResult, InternalResourceDef } from './shared.js'

// Import sub-module definitions
import { getCoreResourceDefinitions } from './core/index.js'
import { getGraphResourceDefinitions } from './graph.js'
import { getGitHubResourceDefinitions } from './github.js'
import { getTemplateResourceDefinitions } from './templates.js'
import { getTeamResourceDefinitions } from './team.js'
import { getHelpResourceDefinitions } from './help.js'
import type { InternalResourceDef, ResourceResult } from './shared.js'
import { ResourceNotFoundError } from '../../types/errors.js'
import { getAuditResourceDef } from '../../audit/index.js'
import { getGlobalAuditLogger } from '../tools/index.js'

/**
 * Get all resource definitions for MCP list
 */
export function getResources(): object[] {
    const resources = getAllResourceDefinitions()
    return resources.map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
        annotations: r.annotations,
        icons: r.icons,
    }))
}

/**
 * Check if a result is a ResourceResult with annotations
 */
function isResourceResult(result: unknown): result is ResourceResult {
    return (
        result !== null &&
        typeof result === 'object' &&
        'data' in result &&
        (result as Record<string, unknown>)['data'] !== undefined
    )
}

/**
 * Extract base URI without query parameters for matching
 */
function getBaseUri(uri: string): string {
    // Handle memory:// URIs specially since URL parser treats the path as host
    if (uri.startsWith('memory://')) {
        const withoutScheme = uri.slice('memory://'.length)
        const queryIndex = withoutScheme.indexOf('?')
        const hashIndex = withoutScheme.indexOf('#')

        // Find first delimiter (query or hash)
        let endIndex = withoutScheme.length
        if (queryIndex !== -1 && queryIndex < endIndex) endIndex = queryIndex
        if (hashIndex !== -1 && hashIndex < endIndex) endIndex = hashIndex

        return 'memory://' + withoutScheme.slice(0, endIndex)
    }

    // Fallback for other URI schemes
    try {
        const url = new URL(uri)
        return `${url.protocol}//${url.host}${url.pathname}`
    } catch {
        // Invalid URL, return original
        return uri
    }
}

/**
 * Read a resource by URI - returns data and optional annotations
 */
export async function readResource(
    uri: string,
    db: IDatabaseAdapter,
    vectorManager?: VectorSearchManager,
    filterConfig?: ToolFilterConfig | null,
    github?: GitHubIntegration | null,
    scheduler?: Scheduler | null,
    teamDb?: IDatabaseAdapter,
    briefingConfig?: BriefingConfig
): Promise<{ data: unknown; annotations?: { lastModified?: string } }> {
    const resources = getAllResourceDefinitions()
    const context = { db, teamDb, vectorManager, filterConfig, github, scheduler, briefingConfig }

    // Strip query parameters for matching, but pass full URI to handler
    const baseUri = getBaseUri(uri)

    // Check for exact match first (using base URI without query params)
    const exactMatch = resources.find((r) => r.uri === baseUri)
    if (exactMatch) {
        // Pass full URI (with query params) to handler so it can parse them
        const result = await Promise.resolve(exactMatch.handler(uri, context))
        if (isResourceResult(result)) {
            return { data: result.data, annotations: result.annotations }
        }
        return { data: result }
    }

    // Check for template matches (also use base URI)
    for (const resource of resources) {
        if (resource.uri.includes('{')) {
            // Use (.+) for {+repo} to allow slashes (e.g., owner/repo), otherwise use ([^/]+)
            const pattern = resource.uri.replace(
                /\{([^}]+)\}/g,
                (_match: string, paramName: string) => {
                    const cleanParam = paramName.startsWith('+') ? paramName.slice(1) : paramName
                    return cleanParam === 'repo' ? '(.+)' : '([^/]+)'
                }
            )
            const regex = new RegExp(`^${pattern}$`)
            if (regex.test(baseUri)) {
                const result = await Promise.resolve(resource.handler(uri, context))
                if (isResourceResult(result)) {
                    return { data: result.data, annotations: result.annotations }
                }
                return { data: result }
            }
        }
    }

    throw new ResourceNotFoundError('Resource', uri)
}

/**
 * Get all resource definitions by composing sub-module definitions
 */
function getAllResourceDefinitions(): InternalResourceDef[] {
    return [
        ...getCoreResourceDefinitions(),
        ...getGraphResourceDefinitions(),
        ...getGitHubResourceDefinitions(),
        ...getTemplateResourceDefinitions(),
        ...getTeamResourceDefinitions(),
        ...getHelpResourceDefinitions(),
        // Audit resource — bound to the global audit logger (or null if unconfigured)
        getAuditResourceDef(getGlobalAuditLogger),
    ]
}
