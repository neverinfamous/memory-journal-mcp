import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { VectorSearchManager } from '../../vector/vector-search-manager/index.js'
import type { GitHubIntegration } from '../../github/github-integration/index.js'
import type { ToolHandlerConfig } from '../../types/index.js'

/** Cached dependency references for invalidating the compiled tool map when runtime state changes. */
export interface CachedToolContextRefs {
    db: IDatabaseAdapter
    github?: GitHubIntegration | undefined
    githubAvailable?: boolean | undefined
    vectorManager?: VectorSearchManager | undefined
    vectorInitialized?: boolean | undefined
    config?: ToolHandlerConfig | undefined
    agentHealing?: boolean | undefined
    codemodeEnabled?: boolean | undefined
    codemodeInternalFullAccess?: boolean | undefined
    teamDb?: IDatabaseAdapter | undefined
    teamVectorManager?: VectorSearchManager | undefined
    teamVectorInitialized?: boolean | undefined
}

const RUNTIME_ONLY_CONFIG_CACHE = new WeakMap<object, ToolHandlerConfig>()

/** Return a canonical `{ runtime }` wrapper config per runtime object so resource readers do not thrash tool caches. */
export function getRuntimeWrapperConfig(
    runtime: ToolHandlerConfig['runtime'] | undefined
): ToolHandlerConfig | undefined {
    if (runtime === undefined) return undefined
    let cached = RUNTIME_ONLY_CONFIG_CACHE.get(runtime)
    if (cached === undefined) {
        cached = { runtime }
        RUNTIME_ONLY_CONFIG_CACHE.set(runtime, cached)
    }
    return cached
}

export function isBareRuntimeWrapperConfig(config: ToolHandlerConfig | undefined): boolean {
    return (
        config?.runtime !== undefined &&
        RUNTIME_ONLY_CONFIG_CACHE.get(config.runtime) === config
    )
}
