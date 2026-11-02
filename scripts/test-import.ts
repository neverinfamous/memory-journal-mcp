import { getResources } from '../src/handlers/resources/index.js'
import { getPrompts } from '../src/handlers/prompts/index.js'
import { getTools } from '../src/handlers/tools/index.js'
import type { IDatabaseAdapter } from '../src/database/core/interfaces.js'

const mockDb = new Proxy({}, { get: () => () => ({}) }) as unknown as IDatabaseAdapter
const tools = getTools(mockDb, null)

console.log('Tools:', tools.length)
console.log('Resources:', getResources().length)
console.log('Prompts:', getPrompts().length)
