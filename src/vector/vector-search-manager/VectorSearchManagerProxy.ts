import { requestContextStorage } from '../../utils/request-context.js'
import type { VectorSearchManager } from './index.js'

export const VectorSearchManagerProxy = {
    create(primary: VectorSearchManager, testManager?: VectorSearchManager): VectorSearchManager {
        return new Proxy(primary, {
            get(target, prop, _receiver) {
                const context = requestContextStorage.getStore()
                const activeTarget = (context?.useTestDb && testManager) ? testManager : target
                const value = Reflect.get(activeTarget, prop, activeTarget) as unknown
                if (typeof value === 'function') {
                    return (value as (...args: unknown[]) => unknown).bind(activeTarget)
                }
                return value
            }
        })
    }
}
