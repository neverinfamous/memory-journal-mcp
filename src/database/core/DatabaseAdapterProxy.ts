import { requestContextStorage } from '../../utils/request-context.js'
import type { IDatabaseAdapter } from './interfaces.js'

export const DatabaseAdapterProxy = {
    create(primary: IDatabaseAdapter, testDb?: IDatabaseAdapter): IDatabaseAdapter {
        return new Proxy(primary, {
            get(target, prop, _receiver) {
                const context = requestContextStorage.getStore()
                const activeTarget = (context?.useTestDb && testDb) ? testDb : target
                const value = Reflect.get(activeTarget, prop, activeTarget) as unknown
                if (typeof value === 'function') {
                    return (value as (...args: unknown[]) => unknown).bind(activeTarget)
                }
                return value
            }
        })
    }
}
