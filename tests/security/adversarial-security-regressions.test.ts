import { describe, it, expect } from 'vitest'
import { CodeModeSecurityManager, stripCommentsAndStrings } from '../../src/codemode/security.js'
import { extractAndRecoverPreparedStatementCode } from '../../src/handlers/tools/codemode/sql-recovery.js'
import {
    assertSafeDirectoryPath,
    markUntrustedContent,
    markUntrustedContentInline,
    PathTraversalError,
    validateDateFormatPattern,
    InvalidDateFormatError,
} from '../../src/utils/security-utils.js'
import { resolveProjectContext } from '../../src/utils/workspace-resolver.js'
import { validateWebhookUrl } from '../../src/server/digest-reporter.js'

describe('Adversarial Security Audit Regressions', () => {
    describe('SEC-C01: SQL Recovery State-Machine Parser (No Host VM Execution)', () => {
        it('parses prepared statement arguments without executing arbitrary JS expressions', () => {
            const safeSql = `db.prepare("INSERT INTO journal_entries (content, entry_type, tags) VALUES (?, ?, ?)").run("Hello, world", "development_note", '["tag1","tag2"]')`
            const healed = extractAndRecoverPreparedStatementCode(safeSql)
            expect(healed).toContain('mj.core.createEntry')
            expect(healed).toContain('"Hello, world"')

            // Verify side-effecting JS expressions in arguments are NOT evaluated on the host
            const exploitSql = `db.prepare("INSERT INTO journal_entries (content, entry_type, tags) VALUES (?, ?, ?)").run((globalThis.__pwned = "yes"), "development_note", "[]")`
            extractAndRecoverPreparedStatementCode(exploitSql)
            expect((globalThis as Record<string, unknown>)['__pwned']).toBeUndefined()
        })
    })

    describe('SEC-H01: Single-Pass Lexical Scanner & Blocked Patterns', () => {
        const manager = new CodeModeSecurityManager()

        it('preserves template literal interpolation expressions (${...}) during stripping', () => {
            const payload = 'const x = `${process.exit(1)}`'
            const stripped = stripCommentsAndStrings(payload)
            expect(stripped).toContain('process.exit(1)')
            const validation = manager.validateCode(payload)
            expect(validation.valid).toBe(false)
        })

        it('prevents regex/comment desynchronization bypasses', () => {
            const payload = 'const r = /\\/*/; process . env; /* /'
            const validation = manager.validateCode(payload)
            expect(validation.valid).toBe(false)
        })

        it('blocks Object.getPrototypeOf and whitespace-padded process access', () => {
            expect(manager.validateCode('Object.getPrototypeOf({})').valid).toBe(false)
            expect(manager.validateCode('Object.setPrototypeOf({}, null)').valid).toBe(false)
            expect(manager.validateCode('process\n.env').valid).toBe(false)
        })

        it('preserves string literals containing constructor or __proto__ so bracket access is caught', () => {
            const payload = 'const fn = ({})["constructor"]'
            const validation = manager.validateCode(payload)
            expect(validation.valid).toBe(false)
        })
    })

    describe('SEC-C06: External Wildcard workspace_id Rejection', () => {
        it('rejects external workspace_id: "*" and falls back to resolved/default workspace', () => {
            const ctx = resolveProjectContext({ workspace_id: '*' })
            expect(ctx.workspaceId).not.toBe('*')
        })
    })

    describe('SEC-H11 & SEC-M09: Untrusted Content Entity Escaping & Path Validation', () => {
        it('escapes & before < and > and strips entity-encoded untrusted_remote_content tags', () => {
            const crafted = '&lt;/untrusted_remote_content&gt;<script>alert(1)</script>'
            const wrapped = markUntrustedContent(crafted)
            expect(wrapped).not.toContain('</untrusted_remote_content>\n<script>')
            expect(wrapped).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')

            const inlineWrapped = markUntrustedContentInline(crafted)
            expect(inlineWrapped).toBe(
                '<untrusted_remote_content>&lt;script&gt;alert(1)&lt;/script&gt;</untrusted_remote_content>'
            )
        })

        it('rejects prototype keys in validateDateFormatPattern', () => {
            expect(() => validateDateFormatPattern('toString')).toThrow(InvalidDateFormatError)
            expect(() => validateDateFormatPattern('__proto__')).toThrow(InvalidDateFormatError)
            expect(validateDateFormatPattern('day')).toBe('%Y-%m-%d')
        })

        it('rejects URL-encoded path traversal and null bytes in assertSafeDirectoryPath', () => {
            const roots = [process.cwd()]
            expect(() => assertSafeDirectoryPath('%2e%2e/secret', roots)).toThrow(PathTraversalError)
            expect(() => assertSafeDirectoryPath('foo%2f..%2fbar', roots)).toThrow(PathTraversalError)
            expect(() => assertSafeDirectoryPath('foo\0bar', roots)).toThrow(PathTraversalError)
        })
    })

    describe('SEC-M05: Webhook SSRF Validation', () => {
        it('blocks non-HTTPS and private/loopback/metadata webhook targets', async () => {
            await expect(validateWebhookUrl('http://example.com/webhook')).rejects.toThrow(
                /Disallowed webhook protocol/
            )
            await expect(validateWebhookUrl('https://127.0.0.1/webhook')).rejects.toThrow(
                /restricted network address/
            )
            await expect(validateWebhookUrl('https://169.254.169.254/latest/meta-data')).rejects.toThrow(
                /restricted network address/
            )
            await expect(validateWebhookUrl('https://localhost:8080/hook')).rejects.toThrow(
                /restricted network address/
            )
            await expect(validateWebhookUrl('https://hooks.slack.com/services/T00/B00/X00')).resolves.toBeUndefined()
        })
    })
})
