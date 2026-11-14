import { getResources } from '../src/handlers/resources/index.js'
import { getPrompts } from '../src/handlers/prompts/index.js'
import { getTools } from '../src/handlers/tools/index.js'
import type { IDatabaseAdapter } from '../src/database/core/interfaces.js'

function isDatabaseAdapter(value: unknown): value is IDatabaseAdapter {
    return typeof value === 'object' && value !== null
}

function createMockDbAdapter(): IDatabaseAdapter {
    const target: object = Object.create(null)
    const proxy: unknown = new Proxy(target, { get: () => () => ({}) })
    if (!isDatabaseAdapter(proxy)) {
        throw new Error('Mock database adapter was not created')
    }
    return proxy
}

const mockDb = createMockDbAdapter()
const tools = getTools(mockDb, null)

console.log('Tools:', tools.length)
console.log('Resources:', getResources().length)
console.log('Prompts:', getPrompts().length)
