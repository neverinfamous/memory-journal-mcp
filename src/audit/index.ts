/**
 * Audit Module Barrel
 *
 * Re-exports the audit logger, interceptor, resource handler, and types.
 */

export { AuditLogger } from './audit-logger.js'

export { createAuditInterceptor } from './interceptor.js'
export type { AuditInterceptor, AuditToolHandlerFn } from './interceptor.js'

export type {
    AuditEntry,
    AuditConfig,
    AuditCategory,
} from './types.js'

export {
    DEFAULT_AUDIT_LOG_MAX_SIZE_BYTES,
} from './types.js'

export { getAuditResourceDef } from './audit-resource.js'
