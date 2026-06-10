/**
 * Code Mode API barrel — re-exports types, param normalization,
 * group factory, and JournalApi class.
 */

export type { ToolDispatcher, GroupApiRecord } from './types.js'
export { parseProjectRegistry } from './types.js'
export { convertKeysToSnakeCase, normalizeParams } from './param-normalizer.js'
export { toolNameToMethodName, createGroupApi } from './group-factory.js'
export { JournalApi, createJournalApi } from './journal-api.js'
