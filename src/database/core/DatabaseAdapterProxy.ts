import { requestContextStorage } from '../../utils/request-context.js'
import { ConfigurationError } from '../../types/errors.js'
import type { IDatabaseAdapter } from './interfaces.js'

const ASYNC_ADAPTER_METHODS = new Set<PropertyKey>([
    'initialize',
    'exportToFile',
    'restoreFromFile',
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

function createUnconfiguredTestDbError(): ConfigurationError {
    return new ConfigurationError(
        'Test database requested (use_test_db=true), but no test database is configured.'
    )
}

function isCallable(value: unknown): value is (...args: unknown[]) => unknown {
    return typeof value === 'function'
}

export const DatabaseAdapterProxy = {
    create(primary: IDatabaseAdapter, testDb?: IDatabaseAdapter): IDatabaseAdapter {
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
                if (context?.useTestDb === true && testDb === undefined) {
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
                    if (ASYNC_ADAPTER_METHODS.has(prop)) {
                        return (): Promise<never> => Promise.reject(createUnconfiguredTestDbError())
                    }
                    const targetValue = Reflect.get(target, prop, target) as unknown
                    if (typeof targetValue === 'function') {
                        return (): never => {
                            throw createUnconfiguredTestDbError()
                        }
                    }
                    throw createUnconfiguredTestDbError()
                }

                const activeTarget = context?.useTestDb === true && testDb !== undefined ? testDb : target
                const value = Reflect.get(activeTarget, prop, activeTarget) as unknown
                if (isCallable(value)) {
                    return getBoundMethod(activeTarget, prop, value)
                }
                return value
            }
        })
    }
}
