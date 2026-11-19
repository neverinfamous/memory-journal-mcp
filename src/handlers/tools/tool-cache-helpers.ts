import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { VectorSearchManager } from '../../vector/vector-search-manager/index.js'
import type { GitHubIntegration } from '../../github/github-integration/index.js'
import type { ToolDefinition, ToolHandlerConfig } from '../../types/index.js'

/** Cached dependency references for invalidating the compiled tool map when runtime state changes. */
export interface CachedToolContextRefs {
    db: IDatabaseAdapter
    github?: GitHubIntegration | undefined
    vectorManager?: VectorSearchManager | undefined
    config?: ToolHandlerConfig | undefined
    teamDb?: IDatabaseAdapter | undefined
    teamVectorManager?: VectorSearchManager | undefined
}

export function safeIsAvailable(gh: GitHubIntegration | undefined | null): boolean | undefined {
    if (!gh) return undefined
    return gh.isApiAvailable()
}

export function safeIsInitialized(vm: VectorSearchManager | undefined | null): boolean | undefined {
    if (!vm) return undefined
    return typeof vm.isInitialized === 'function' ? vm.isInitialized() : undefined
}

export function isCacheHit(
    refs: CachedToolContextRefs | null | undefined,
    cache: Map<string, ToolDefinition> | null | undefined,
    db: IDatabaseAdapter,
    vectorManager?: VectorSearchManager,
    github?: GitHubIntegration,
    config?: ToolHandlerConfig,
    teamDb?: IDatabaseAdapter,
    teamVectorManager?: VectorSearchManager
): boolean {
    return Boolean(
        cache &&
            refs?.db === db &&
            refs.github === github &&
            safeIsAvailable(refs.github) === safeIsAvailable(github) &&
            refs.vectorManager === vectorManager &&
            safeIsInitialized(refs.vectorManager) === safeIsInitialized(vectorManager) &&
            refs.config === config &&
            refs.teamDb === teamDb &&
            refs.teamVectorManager === teamVectorManager &&
            safeIsInitialized(refs.teamVectorManager) === safeIsInitialized(teamVectorManager)
    )
}
