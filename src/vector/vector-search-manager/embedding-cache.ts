/**
 * Cross-instance query embedding LRU cache and in-flight computation deduplication
 * shared by `VectorSearchManager` instances (bypassed for custom/mock generators).
 */

const QUERY_EMBEDDING_CACHE_MAX = 128
export const QUERY_EMBEDDING_CACHE_MAX_CHARS = 512
const QUERY_EMBEDDING_CACHE = new Map<string, Float32Array>()
const INFLIGHT_EMBEDDINGS = new Map<string, Promise<Float32Array>>()

function setSharedCachedEmbedding(cacheKey: string, vec: Float32Array): void {
    if (QUERY_EMBEDDING_CACHE.has(cacheKey)) {
        QUERY_EMBEDDING_CACHE.delete(cacheKey)
    } else if (QUERY_EMBEDDING_CACHE.size >= QUERY_EMBEDDING_CACHE_MAX) {
        const oldestKey = QUERY_EMBEDDING_CACHE.keys().next().value
        if (oldestKey !== undefined) {
            QUERY_EMBEDDING_CACHE.delete(oldestKey)
        }
    }
    QUERY_EMBEDDING_CACHE.set(cacheKey, vec)
}

/** Clear shared query embedding caches (intended for test isolation). */
export function clearSharedEmbeddingCache(): void {
    QUERY_EMBEDDING_CACHE.clear()
    INFLIGHT_EMBEDDINGS.clear()
}

/**
 * Return a defensive Float32Array copy from the bounded LRU cache, deduplicating
 * concurrent in-flight computations for identical `(modelName, text)` queries.
 */
export async function getOrComputeCachedEmbedding(
    modelName: string,
    text: string,
    canCache: boolean,
    computeRaw: () => Promise<Float32Array>
): Promise<Float32Array> {
    if (!canCache) {
        return computeRaw()
    }
    const cacheKey = `${modelName}\0${text}`
    const cached = QUERY_EMBEDDING_CACHE.get(cacheKey)
    if (cached !== undefined) {
        QUERY_EMBEDDING_CACHE.delete(cacheKey)
        QUERY_EMBEDDING_CACHE.set(cacheKey, cached)
        return cached.slice()
    }
    const inFlight = INFLIGHT_EMBEDDINGS.get(cacheKey)
    if (inFlight !== undefined) {
        return inFlight.then((vec) => vec.slice())
    }

    const promise = computeRaw().then((vec) => {
        setSharedCachedEmbedding(cacheKey, vec)
        return vec
    })
    INFLIGHT_EMBEDDINGS.set(cacheKey, promise)
    try {
        return (await promise).slice()
    } finally {
        INFLIGHT_EMBEDDINGS.delete(cacheKey)
    }
}
