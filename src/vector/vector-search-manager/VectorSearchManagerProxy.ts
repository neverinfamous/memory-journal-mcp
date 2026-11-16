import { requestContextStorage } from '../../utils/request-context.js'
import { ConfigurationError } from '../../types/errors.js'
import type { VectorSearchManager } from './index.js'

const ASYNC_VECTOR_METHODS = new Set<PropertyKey>([
    'initialize',
    'generateEmbedding',
    'addEntry',
    'search',
    'searchByEntryId',
    'rebuildIndex',
])

const PASSTHROUGH_META_PROPS = new Set<PropertyKey>([
    'then',
    'toString',
    'valueOf',
    'toJSON',
    'constructor',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'toLocaleString',
])

function createUnconfiguredTestVectorError(): ConfigurationError {
    return new ConfigurationError(
        'Test vector search manager requested (use_test_db=true), but no test database/vector manager is configured.'
    )
}

export const VectorSearchManagerProxy = {
    create(primary: VectorSearchManager, testManager?: VectorSearchManager): VectorSearchManager {
        return new Proxy(primary, {
            get(target, prop, _receiver) {
                const context = requestContextStorage.getStore()
                if (context?.useTestDb === true && testManager === undefined) {
                    if (prop === 'isInitialized') {
                        return (): boolean => false
                    }
                    if (typeof prop === 'symbol' || PASSTHROUGH_META_PROPS.has(prop)) {
                        const metaValue = Reflect.get(target, prop, target) as unknown
                        if (typeof metaValue === 'function') {
                            return (metaValue as (...args: unknown[]) => unknown).bind(target)
                        }
                        return metaValue
                    }
                    if (ASYNC_VECTOR_METHODS.has(prop)) {
                        return (): Promise<never> => Promise.reject(createUnconfiguredTestVectorError())
                    }
                    const targetValue = Reflect.get(target, prop, target) as unknown
                    if (typeof targetValue === 'function') {
                        return (): never => {
                            throw createUnconfiguredTestVectorError()
                        }
                    }
                    throw createUnconfiguredTestVectorError()
                }

                const activeTarget =
                    context?.useTestDb === true && testManager !== undefined ? testManager : target
                const value = Reflect.get(activeTarget, prop, activeTarget) as unknown
                if (typeof value === 'function') {
                    return (value as (...args: unknown[]) => unknown).bind(activeTarget)
                }
                return value
            }
        })
    }
}
