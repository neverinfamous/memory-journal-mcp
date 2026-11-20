/**
 * Memory Journal MCP Server - Resource Handlers
 *
 * Barrel file composing resource definitions from sub-modules.
 * Exports all MCP resources with annotations following MCP 2025-11-25 spec.
 */

import type { VectorSearchManager } from '../../vector/vector-search-manager/index.js'
import type { ToolFilterConfig } from '../../filtering/tool-filter.js'
import type { GitHubIntegration } from '../../github/github-integration/index.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { ServerRuntime } from '../../utils/maintenance-lock.js'
import { enforceAccessBoundary } from '../../auth/validation.js'

// Re-export shared types
export { getBaseUri } from './shared.js'
export type { ResourceContext, ResourceResult, InternalResourceDef } from './shared.js'

import { getCoreResourceDefinitions } from './core/index.js'
import { getDynamicGraphResourceDefinitions } from './graph.js'
import { getGitHubResourceDefinitions } from './github.js'
import { getTemplateResourceDefinitions } from './templates.js'
import { getAgentContextResource, getAgentIdResource } from './core/agent-context.js'
import { enforceTeamResourceRbac, getTeamResourceDefinitions } from './team.js'
import { getHelpResourceDefinitions } from './help.js'
import { getInsightResourceDefinitions } from './insights.js'
import { getStalenessResourceDefinitions } from './staleness.js'
import { getToolsCatalogResourceDefinitions } from './tools-catalog.js'
import {
    getBaseUri,
    resourceWorkspace,
    type BriefingConfig,
    type InternalResourceDef,
    type ResourceContext,
    type ResourceResult,
} from './shared.js'
import { ResourceNotFoundError, ValidationError } from '../../types/errors.js'
import { getAuditResourceDef } from '../../audit/index.js'

const templateRegexCache = new Map<string, RegExp>()

function getTemplateRegex(uriTemplate: string): RegExp {
    let regex = templateRegexCache.get(uriTemplate)
    if (regex === undefined) {
        const escapedUri = uriTemplate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const pattern = escapedUri.replace(
            /\\{([^}]+)\\}/g,
            (_match: string, paramName: string) => {
                const cleanParam = paramName.replace(/^\\?\+/, '')
                return cleanParam === 'repo' ? '(.+)' : '([^/]+)'
            }
        )
        regex = new RegExp(`^${pattern}$`)
        templateRegexCache.set(uriTemplate, regex)
    }
    return regex
}

let cachedStaticResources: InternalResourceDef[] | null = null
const runtimeResourcesCache = new WeakMap<ServerRuntime, InternalResourceDef[]>()

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
        ...(r.capabilities !== undefined ? { capabilities: r.capabilities } : {}),
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
 * Read a resource by URI - returns data and optional annotations
 */
export async function readResource(
    uri: string,
    db: IDatabaseAdapter,
    vectorManager?: VectorSearchManager,
    filterConfig?: ToolFilterConfig | null,
    github?: GitHubIntegration | null,
    teamDb?: IDatabaseAdapter,
    briefingConfig?: BriefingConfig,
    runtime?: ServerRuntime
): Promise<{ data: unknown; annotations?: { lastModified?: string } }> {
    if (Buffer.byteLength(uri, 'utf8') > 8192) {
        throw new ValidationError('Resource URI exceeds maximum length of 8192 bytes')
    }
    const resources = getAllResourceDefinitions(runtime)
    const context = {
        db,
        teamDb,
        vectorManager,
        filterConfig,
        github,
        briefingConfig,
        runtime,
        resourceCount: resources.length,
    }

    // Strip query parameters for matching, but pass full URI to handler
    const baseUri = getBaseUri(uri)

    // Check for exact match first (using base URI without query params)
    const exactMatch = resources.find((r) => r.uri === baseUri)
    if (exactMatch) {
        // Authorization Hook: Enforce scope if auth context exists
        enforceAccessBoundary(baseUri, 'resource', exactMatch.capabilities, runtime?.auditLogger)

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
            if (getTemplateRegex(resource.uri).test(baseUri)) {
                // Authorization Hook: Enforce scope if auth context exists
                enforceAccessBoundary(
                    baseUri,
                    'resource',
                    resource.capabilities,
                    runtime?.auditLogger
                )

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
 * Common hallucinated resource URIs mapped to their canonical equivalents.
 * Agents frequently prefix paths with 'journal/' or 'entries/' when the
 * actual URIs are flat (e.g., 'memory://recent', not 'memory://journal/recent').
 */
const RESOURCE_URI_ALIASES: Record<string, string> = {
    'memory://journal/recent': 'memory://recent',
    'memory://journal/briefing': 'memory://briefing',
    'memory://entries/recent': 'memory://recent',
    'memory://status': 'memory://health',
    'memory://server': 'memory://health',
    'memory://tools': 'memory://help',
    'memory://agent-id': 'memory://agent-context/default',
    'memory://agent-context': 'memory://agent-context/default',
}

/**
 * Generate alias resource definitions for common hallucinated URIs.
 * Each alias clones the canonical resource but with the alias URI,
 * delegating to the canonical handler with the canonical URI.
 */
function generateResourceAliases(resources: InternalResourceDef[]): InternalResourceDef[] {
    const aliases: InternalResourceDef[] = []
    for (const [aliasUri, canonicalUri] of Object.entries(RESOURCE_URI_ALIASES)) {
        const canonical = resources.find((r) => {
            if (r.uri === canonicalUri) return true
            if (r.uri.includes('{')) {
                return getTemplateRegex(r.uri).test(canonicalUri)
            }
            return false
        })
        if (canonical !== undefined) {
            aliases.push({
                ...canonical,
                uri: aliasUri,
                name: `${canonical.name} (alias)`,
                // Delegate to canonical handler with caller's URI so bare aliases resolve context without forcing `/default` (H17)
                handler: (uri, context) => canonical.handler(uri, context),
            })
        }
    }
    return aliases
}

/**
 * Get all resource definitions by composing sub-module definitions
 */
function getAllResourceDefinitions(runtime?: ServerRuntime): InternalResourceDef[] {
    if (runtime !== undefined) {
        const cached = runtimeResourcesCache.get(runtime)
        if (cached !== undefined) return cached
    } else if (cachedStaticResources !== null) {
        return cachedStaticResources
    }

    const coreResources = [
        ...getCoreResourceDefinitions(),
        ...getDynamicGraphResourceDefinitions(),
        ...getGitHubResourceDefinitions(),
        ...getTemplateResourceDefinitions(),
        getAgentContextResource(),
        getAgentIdResource(),
        ...getTeamResourceDefinitions(),
        ...getHelpResourceDefinitions(),
        ...getInsightResourceDefinitions(),
        ...getStalenessResourceDefinitions(),
        ...getToolsCatalogResourceDefinitions(),
        // Audit resource — bound to the runtime's instance audit logger
        getAuditResourceDef(() => runtime?.auditLogger ?? null),
    ]
    const all = [...coreResources, ...generateResourceAliases(coreResources)]
    if (runtime !== undefined) {
        runtimeResourcesCache.set(runtime, all)
    } else {
        cachedStaticResources = all
    }
    return all
}

/**
 * Validates whether the current request is authorized to subscribe to a resource.
 * Throws an error if the URI is not found or the user lacks the required scope.
 */
export function validateResourceSubscription(
    uri: string,
    runtime?: ServerRuntime,
    teamDb?: IDatabaseAdapter,
    briefingConfig?: BriefingConfig
): void {
    if (Buffer.byteLength(uri, 'utf8') > 8192) {
        throw new ValidationError('Resource URI exceeds maximum length of 8192 bytes')
    }
    const resources = getAllResourceDefinitions(runtime)
    const baseUri = getBaseUri(uri)

    const checkTeamSubscriptionRbac = (capabilities: InternalResourceDef['capabilities']): void => {
        if (capabilities?.requiresTeamScope !== true || teamDb === undefined) return
        const subCtx: ResourceContext = {
            db: teamDb,
            teamDb,
            ...(briefingConfig !== undefined ? { briefingConfig } : {}),
            ...(runtime !== undefined ? { runtime } : {}),
        }
        enforceTeamResourceRbac(subCtx, resourceWorkspace(subCtx))
    }

    const exactMatch = resources.find((r) => r.uri === baseUri)
    if (exactMatch) {
        enforceAccessBoundary(baseUri, 'resource', exactMatch.capabilities, runtime?.auditLogger)
        checkTeamSubscriptionRbac(exactMatch.capabilities)
        return
    }

    // Check for template matches
    for (const resource of resources) {
        if (resource.uri.includes('{')) {
            if (getTemplateRegex(resource.uri).test(baseUri)) {
                enforceAccessBoundary(
                    baseUri,
                    'resource',
                    resource.capabilities,
                    runtime?.auditLogger
                )
                checkTeamSubscriptionRbac(resource.capabilities)
                return
            }
        }
    }

    throw new ResourceNotFoundError('Resource', uri)
}
