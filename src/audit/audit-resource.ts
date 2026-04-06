/**
 * Audit Resource Handler
 *
 * Serves the memory://audit resource — the last 50 audit entries
 * as a structured, YAML-style text payload with a session summary
 * including token totals and error counts.
 *
 * Per mcp-builder §2.3: annotated as ASSISTANT_FOCUSED (agent-only).
 *
 * When audit logging is not configured, returns a brief informational
 * message with a setup hint.
 *
 * Uses the AuditLogger.recent() streaming tail-read (64KB window)
 * instead of loading the entire file — O(1) memory regardless of
 * audit log size.
 */

import type { InternalResourceDef, ResourceContext, ResourceResult } from '../handlers/resources/shared.js'
import { ASSISTANT_FOCUSED } from '../utils/resource-annotations.js'
import type { AuditLogger } from './audit-logger.js'

// ============================================================================
// Resource Factory
// ============================================================================

/**
 * Returns the InternalResourceDef for memory://audit.
 * The AuditLogger instance is bound at creation time.
 *
 * @param getLogger - A function that returns the current AuditLogger instance (or null).
 *                    Using a getter function avoids capturing a null reference at registration
 *                    time — the logger may not exist yet when resources are registered.
 */
export function getAuditResourceDef(getLogger: () => AuditLogger | null): InternalResourceDef {
    return {
        uri: 'memory://audit',
        name: 'Audit Log',
        title: 'Audit Trail (last 50 entries)',
        description:
            'Last 50 write/admin tool call audit entries from the JSONL audit log. ' +
            'Each entry includes tool name, scope, duration, token estimates, and error status. ' +
            'Includes a session summary with total token consumption and error count.',
        mimeType: 'text/plain',
        annotations: {
            ...ASSISTANT_FOCUSED,
        },
        handler: async (_uri: string, _context: ResourceContext): Promise<ResourceResult> => {
            const lastModified = new Date().toISOString()
            const auditLogger = getLogger()

            if (!auditLogger) {
                return {
                    data:
                        'audit: not configured\n' +
                        'hint: Set AUDIT_LOG_PATH env var or --audit-log CLI flag to enable audit logging.',
                    annotations: { lastModified },
                }
            }

            const entries = await auditLogger.recent(50)

            if (entries.length === 0) {
                return {
                    data:
                        `audit_log: ${auditLogger.config.logPath}\n` +
                        'entries: 0\n' +
                        'note: No write/admin operations have been audited yet.',
                    annotations: { lastModified },
                }
            }

            // Compute session summary
            let totalTokens = 0
            let errorCount = 0
            let totalDuration = 0
            for (const e of entries) {
                totalTokens += e.tokenEstimate ?? 0
                totalDuration += e.durationMs
                if (!e.success) errorCount++
            }

            // Format each entry as readable YAML-style text
            const formattedEntries = entries
                .map((e) => {
                    const parts: string[] = [
                        `- timestamp: ${e.timestamp}`,
                        `  tool: ${e.tool}`,
                        `  scope: ${e.scope}`,
                        `  category: ${e.category}`,
                        `  duration_ms: ${String(e.durationMs)}`,
                        `  success: ${String(e.success)}`,
                    ]
                    if (e.error) {
                        parts.push(`  error: ${e.error}`)
                    }
                    if (e.tokenEstimate !== undefined) {
                        parts.push(`  token_estimate: ${String(e.tokenEstimate)}`)
                    }
                    if (e.args !== undefined) {
                        parts.push(`  args: ${JSON.stringify(e.args)}`)
                    }
                    return parts.join('\n')
                })
                .join('\n')

            const text =
                `audit_log: ${auditLogger.config.logPath}\n` +
                `entries_shown: ${String(entries.length)}\n` +
                `as_of: ${lastModified}\n` +
                `session_summary:\n` +
                `  total_tokens: ${String(totalTokens)}\n` +
                `  total_duration_ms: ${String(totalDuration)}\n` +
                `  error_count: ${String(errorCount)}\n` +
                `  redact_mode: ${String(auditLogger.config.redact)}\n\n` +
                formattedEntries

            return {
                data: text,
                annotations: { lastModified },
            }
        },
    }
}
