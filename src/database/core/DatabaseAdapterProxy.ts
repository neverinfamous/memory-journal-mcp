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

export const DatabaseAdapterProxy = {
    create(primary: IDatabaseAdapter, testDb?: IDatabaseAdapter): IDatabaseAdapter {
        return new Proxy(primary, {
            get(target, prop, _receiver) {
                const context = requestContextStorage.getStore()
                if (context?.useTestDb === true && testDb === undefined) {
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
                if (typeof value === 'function') {
                    return (value as (...args: unknown[]) => unknown).bind(activeTarget)
                }
                return value
            }
        })
    }
}
