import { requestContextStorage } from '../../utils/request-context.js'
import { ConfigurationError } from '../../types/errors.js'
import type { VectorSearchManager } from './index.js'

const ASYNC_VECTOR_METHODS = new Set<PropertyKey>([
    'initialize',
    'generateEmbedding',
    'generateEmbeddings',
    'generateEmbeddingsSettled',
    'addEntry',
    'addEntries',
    'search',
    'searchCandidates',
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

function isCallable(value: unknown): value is (...args: unknown[]) => unknown {
    return typeof value === 'function'
}

export const VectorSearchManagerProxy = {
    create(primary: VectorSearchManager, testManager?: VectorSearchManager): VectorSearchManager {
        const boundMethodCache = new WeakMap<
            object,
            Map<
                PropertyKey,
                { raw: (...args: unknown[]) => unknown; bound: (...args: unknown[]) => unknown }
            >
        >()
        const getBoundMethod = (
            targetObj: object,
            prop: PropertyKey,
            fn: (...args: unknown[]) => unknown
        ): ((...args: unknown[]) => unknown) => {
            let perTarget = boundMethodCache.get(targetObj)
            if (perTarget === undefined) {
                perTarget = new Map()
                boundMethodCache.set(targetObj, perTarget)
            }
            const cached = perTarget.get(prop)
            if (cached?.raw === fn) {
                return cached.bound
            }
            const bound = fn.bind(targetObj)
            perTarget.set(prop, { raw: fn, bound })
            return bound
        }

        return new Proxy(primary, {
            get(target, prop, _receiver) {
                const context = requestContextStorage.getStore()
                if (context?.useTestDb === true && testManager === undefined) {
                    if (prop === 'isInitialized') {
                        return (): boolean => false
                    }
                    if (typeof prop === 'symbol' || PASSTHROUGH_META_PROPS.has(prop)) {
                        const metaValue = Reflect.get(target, prop, target) as unknown
                        if (isCallable(metaValue)) {
                            return getBoundMethod(target, prop, metaValue)
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
                if (isCallable(value)) {
                    return getBoundMethod(activeTarget, prop, value)
                }
                return value
            }
        })
    }
}
