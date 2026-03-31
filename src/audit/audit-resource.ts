/**
 * Audit Resource Handler
 *
 * Serves the memory://audit resource — the last 50 lines of the JSONL
 * audit log as a structured, YAML-style text payload.
 *
 * Per mcp-builder §2.3: annotated as ASSISTANT_FOCUSED (agent-only).
 *
 * When the audit log is not configured or the file doesn't exist,
 * returns a brief informational message rather than an error.
 */

import fs from 'node:fs'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../handlers/resources/shared.js'
import { ASSISTANT_FOCUSED } from '../utils/resource-annotations.js'

// ============================================================================
// Tail Helper
// ============================================================================

/**
 * Read the last N lines from a file.
 * Returns [] when the file doesn't exist or can't be read.
 */
function tailLines(filePath: string, n: number): string[] {
    try {
        const content = fs.readFileSync(filePath, 'utf8')
        const lines = content.split('\n').filter((l) => l.trim().length > 0)
        return lines.slice(-n)
    } catch {
        return []
    }
}

// ============================================================================
// Resource Factory
// ============================================================================

/**
 * Returns the InternalResourceDef for memory://audit.
 * The logPath is bound at creation time from config.
 */
export function getAuditResourceDef(logPath: string | undefined): InternalResourceDef {
    return {
        uri: 'memory://audit',
        name: 'Audit Log',
        title: 'Audit Trail (last 50 entries)',
        description:
            'Last 50 write/admin tool call audit entries from the JSONL audit log. ' +
            'Each entry includes tool name, scope, duration, token estimates, and error status.',
        mimeType: 'text/plain',
        annotations: {
            ...ASSISTANT_FOCUSED,
        },
        handler: (_uri: string, _context: ResourceContext): ResourceResult => {
            const lastModified = new Date().toISOString()

            if (!logPath) {
                return {
                    data:
                        'audit: not configured\n' +
                        'hint: Set AUDIT_LOG_PATH env var or --audit-log CLI flag to enable audit logging.',
                    annotations: { lastModified },
                }
            }

            const lines = tailLines(logPath, 50)

            if (lines.length === 0) {
                return {
                    data:
                        `audit_log: ${logPath}\n` +
                        'entries: 0\n' +
                        'note: No write/admin operations have been audited yet.',
                    annotations: { lastModified },
                }
            }

            // Parse and format as readable YAML-style text to save tokens
            const entries = lines
                .map((line) => {
                    try {
                        const e = JSON.parse(line) as Record<string, unknown>
                        const ts = typeof e['timestamp'] === 'string' ? e['timestamp'] : 'unknown'
                        const tool = typeof e['toolName'] === 'string' ? e['toolName'] : 'unknown'
                        const scope = typeof e['scope'] === 'string' ? e['scope'] : 'unknown'
                        const dur = typeof e['durationMs'] === 'number' ? e['durationMs'] : 0
                        const inTok = typeof e['inputTokens'] === 'number' ? e['inputTokens'] : 0
                        const outTok = typeof e['outputTokens'] === 'number' ? e['outputTokens'] : 0
                        const parts: string[] = [
                            `- timestamp: ${ts}`,
                            `  tool: ${tool}`,
                            `  scope: ${scope}`,
                            `  duration_ms: ${dur}`,
                            `  input_tokens: ${inTok}`,
                            `  output_tokens: ${outTok}`,
                            `  error: ${e['isError'] === true ? 'true' : 'false'}`,
                        ]
                        if (e['args'] !== undefined) {
                            parts.push(`  args: ${JSON.stringify(e['args'])}`)
                        }
                        return parts.join('\n')
                    } catch {
                        return `- raw: ${line}`
                    }
                })
                .join('\n')

            const text =
                `audit_log: ${logPath}\n` +
                `entries_shown: ${lines.length}\n` +
                `as_of: ${lastModified}\n\n` +
                entries

            return {
                data: text,
                annotations: { lastModified },
            }
        },
    }
}
