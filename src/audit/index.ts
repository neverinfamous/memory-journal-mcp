/**
 * Audit Module Barrel
 *
 * Re-exports the audit logger and resource handler.
 */

export {
    AuditLogger,
    NullAuditLogger,
    createAuditLogger,
} from './audit-logger.js'

export type {
    AuditEntry,
    AuditLoggerConfig,
    AuditLoggerInstance,
} from './audit-logger.js'

export { getAuditResourceDef } from './audit-resource.js'
