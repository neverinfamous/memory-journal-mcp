import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { getAuthContext } from '../../../auth/auth-context.js'
import { getRequestContext } from '../../../utils/request-context.js'
import { createSandboxPool, type ISandboxPool } from '../../../codemode/sandbox-factory.js'
import { CodeModeSecurityManager } from '../../../codemode/security/security-manager.js'

import { getCoreTools } from '../core/index.js'
import { getSearchTools } from '../search/index.js'
import { getAnalyticsTools } from '../analytics.js'
import { getRelationshipTools } from '../relationships.js'
import { getIoTools } from '../io/index.js'
import { getAdminTools } from '../admin/index.js'
import { getGitHubTools } from '../github.js'
import { getBackupTools } from '../backup.js'
import { getTeamTools } from '../team/index.js'
import { getCopilotTools } from '../github/index.js'

// ============================================================================
// Singleton State & Caching
// ============================================================================

export interface CacheEntry<T> {
    value: T
    lastAccessed: number
}

export const securityManagerMap = new Map<string, CacheEntry<CodeModeSecurityManager>>()

let globalSandboxPool: ISandboxPool | null = null

export function getSandboxPool(): ISandboxPool {
    if (!globalSandboxPool) {
        globalSandboxPool = createSandboxPool()
    }
    return globalSandboxPool
}

export function sweepCaches() {
    const now = Date.now()
    const TTL = 10 * 60 * 1000 // 10 minutes
    for (const [key, entry] of securityManagerMap.entries()) {
        if (now - entry.lastAccessed > TTL) {
            securityManagerMap.delete(key)
        }
    }
}

// Ensure the map doesn't grow unboundedly under load
export function evictExcessCaches() {
    if (securityManagerMap.size > 1000) {
        // Evict oldest 100 entries
        const entries = Array.from(securityManagerMap.entries()).sort(
            (a, b) => a[1].lastAccessed - b[1].lastAccessed
        )
        for (let i = 0; i < 100; i++) {
            const key = entries[i]?.[0]
            if (key) securityManagerMap.delete(key)
        }
    }
}

// Run sweep every 15 minutes
setInterval(sweepCaches, 15 * 60 * 1000).unref()

/**
 * Get or create a security manager tied to the current authentication context.
 */
export function getSecurityManager(context: ToolContext): CodeModeSecurityManager {
    evictExcessCaches()
    
    // Use auth context + project ID as cache key if available, otherwise just use a default key
    // The security manager enforces its own scopes and validations based on what's passed to it
    const authCtx = getAuthContext()
    const requestCtx = getRequestContext()
    
    const scopeId = authCtx ? authCtx.clientId : 'anonymous'
    const projectId = requestCtx?.projectId ?? 'default'
    const cacheKey = `${scopeId}:${projectId}`
    
    let entry = securityManagerMap.get(cacheKey)
    if (!entry) {
        entry = {
            value: new CodeModeSecurityManager({
                authContext: authCtx ?? undefined,
                projectRegistry: context.config?.projectRegistry
            }),
            lastAccessed: Date.now()
        }
        securityManagerMap.set(cacheKey, entry)
    } else {
        entry.lastAccessed = Date.now()
    }
    
    return entry.value
}

let cachedNonCodeModeTools: ToolDefinition[] | null = null
let cachedCodeModeContext: ToolContext | null = null

/**
 * Lazily instantiate and cache all non-codemode tools.
 * Note: this is safe only if ToolContext does not change per-request.
 */
export function collectNonCodeModeTools(context: ToolContext): ToolDefinition[] {
    if (cachedNonCodeModeTools && cachedCodeModeContext === context) {
        return cachedNonCodeModeTools
    }

    const tools = [
        ...getCoreTools(context),
        ...getSearchTools(context),
        ...getAnalyticsTools(context),
        ...getRelationshipTools(context),
        ...getIoTools(context),
        ...getAdminTools(context),
        ...getGitHubTools(context),
        ...getBackupTools(context),
        ...getTeamTools(context),
        ...getCopilotTools(context),
    ]

    cachedNonCodeModeTools = tools.filter((t) => t.name !== 'mj_execute_code')
    cachedCodeModeContext = context
    return cachedNonCodeModeTools
}
