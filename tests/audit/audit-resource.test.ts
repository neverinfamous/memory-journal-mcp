import { describe, it, expect, vi } from 'vitest'
import { getAuditResourceDef } from '../../src/audit/audit-resource.js'
import type { AuditLogger } from '../../src/audit/audit-logger.js'

describe('Audit Resource', () => {
    it('returns setup hint when logger is not configured', async () => {
        const def = getAuditResourceDef(() => null)
        const result = (await def.handler('memory://audit', {} as any)) as any
        
        expect(result.data).toContain('audit: not configured')
        expect(result.data).toContain('hint: Set AUDIT_LOG_PATH env var')
        expect(result.annotations?.lastModified).toBeDefined()
    })

    it('returns 0 entries message when logger has no recent entries', async () => {
        const mockLogger = {
            config: { logPath: '/tmp/audit.jsonl' },
            recent: vi.fn().mockResolvedValue([]),
        } as unknown as AuditLogger

        const def = getAuditResourceDef(() => mockLogger)
        const result = (await def.handler('memory://audit', {} as any)) as any
        
        expect(result.data).toContain('audit_log: /tmp/audit.jsonl')
        expect(result.data).toContain('entries: 0')
        expect(result.data).toContain('No write/admin operations have been audited yet')
    })

    it('returns formatted entries with session summary', async () => {
        const mockLogger = {
            config: { logPath: '/tmp/audit.jsonl', redact: false },
            recent: vi.fn().mockResolvedValue([
                {
                    timestamp: '2026-04-07T08:00:00.000Z',
                    tool: 'create_entry',
                    scope: 'personal',
                    category: 'write',
                    durationMs: 100,
                    success: true,
                    tokenEstimate: 50,
                    args: { test: 'arg' }
                },
                {
                    timestamp: '2026-04-07T08:01:00.000Z',
                    tool: 'admin_command',
                    scope: 'team',
                    category: 'admin',
                    durationMs: 200,
                    success: false,
                    error: 'Permission denied',
                    tokenEstimate: 30
                }
            ]),
        } as unknown as AuditLogger

        const def = getAuditResourceDef(() => mockLogger)
        const result = (await def.handler('memory://audit', {} as any)) as any

        // Session Summary
        expect(result.data).toContain('entries_shown: 2')
        expect(result.data).toContain('total_tokens: 80')
        expect(result.data).toContain('total_duration_ms: 300')
        expect(result.data).toContain('error_count: 1')

        // First Entry
        expect(result.data).toContain('tool: create_entry')
        expect(result.data).toContain('token_estimate: 50')
        expect(result.data).toContain('args: {"test":"arg"}')

        // Second Entry
        expect(result.data).toContain('tool: admin_command')
        expect(result.data).toContain('error: Permission denied')
        expect(result.data).toContain('success: false')
    })
})
