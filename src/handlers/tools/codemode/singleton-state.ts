import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { createSandboxPool, type ISandboxPool } from '../../../codemode/sandbox-factory.js'
import { CodeModeSecurityManager } from '../../../codemode/security.js'

import { getCoreTools, getStalenessTools } from '../core/index.js'
import { getSearchTools } from '../search/index.js'
import { getAnalyticsTools } from '../analytics.js'
import { getRelationshipTools } from '../relationships.js'
import { getIoTools } from '../io/index.js'
import { getAdminTools } from '../admin/index.js'
import { getGitHubTools } from '../github.js'
import { getGitTools } from '../git.js'
import { getBackupTools } from '../backup.js'
import { getTeamTools } from '../team/index.js'

// ============================================================================
// Singleton State & Caching
// ============================================================================

let globalSandboxPool: ISandboxPool | null = null

export function getSandboxPool(): ISandboxPool {
    globalSandboxPool ??= createSandboxPool()
    return globalSandboxPool
}

let globalSecurityManager: CodeModeSecurityManager | null = null

export function getSecurityManager(): CodeModeSecurityManager {
    globalSecurityManager ??= new CodeModeSecurityManager()
    return globalSecurityManager
}

let cachedNonCodeModeTools: ToolDefinition[] | null = null
let cachedCodeModeContext: ToolContext | null = null

/**
 * Dispose the Code Mode sandbox pool and security manager (cleanup interval).
 * Safe to call when neither singleton was created; intended for server shutdown.
 */
export function disposeCodemodeResources(): void {
    const pool = globalSandboxPool
    const security = globalSecurityManager
    globalSandboxPool = null
    globalSecurityManager = null
    cachedNonCodeModeTools = null
    cachedCodeModeContext = null
    pool?.dispose()
    security?.dispose()
}

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
        ...getStalenessTools(context),
        ...getSearchTools(context),
        ...getAnalyticsTools(context),
        ...getRelationshipTools(context),
        ...getIoTools(context),
        ...getAdminTools(context),
        ...getGitHubTools(context),
        ...getBackupTools(context),
        ...getTeamTools(context),
        ...getGitTools(context),
    ]

    cachedNonCodeModeTools = tools.filter((t) => t.name !== 'mj_execute_code')
    cachedCodeModeContext = context
    return cachedNonCodeModeTools
}
