/**
 * Security Audit Pass 51 — Regression Tests (M1–M3, L1–L4, AP1–AP3)
 */

import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'
import { isSafeUserRegex } from '../../src/handlers/tools/core/dummy-healing/directory-search.js'
import {
    compactOversizedResult,
    serializeAndEnforceEgress,
} from '../../src/codemode/worker/result-compactor.js'
import { createSandboxExecutor } from '../../src/codemode/worker/nested-exec-scope.js'
import { validateOAuthTransportConfig } from '../../src/transports/http/security.js'
import { extractAndRecoverEntryCode } from '../../src/handlers/tools/codemode/json-entry-recovery.js'
import { updateConfigurationSchema } from '../../src/handlers/tools/admin/update_configuration.js'
import { assertSafeFilePath } from '../../src/utils/path-safety.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getSecurityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-security.js'
import type { SandboxResult } from '../../src/codemode/types.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'

describe('Pass 51 Security Audit Regressions', () => {
    describe('M1: isSafeUserRegex blocks shorthand overlap, bounded ranges, and nullable-separator ReDoS', () => {
        it('rejects overlapping shorthand pairs, bounded {m,n} ranges, and nullable separators', () => {
            expect(isSafeUserRegex('\\S+\\w+\\S+\\w+\\S+X')).toBe(false)
            expect(isSafeUserRegex('\\w+\\d+\\w+\\d+\\w+X')).toBe(false)
            expect(isSafeUserRegex('.{1,999}.{1,999}.{1,999}.{1,999}X')).toBe(false)
            expect(isSafeUserRegex('a{0,50}a{0,50}X')).toBe(false)
            expect(isSafeUserRegex('a+b?a+b?a+b?a+b?a+X')).toBe(false)
            expect(isSafeUserRegex('\\w+\\s*\\w+')).toBe(false)
            expect(isSafeUserRegex('a+\\ba+')).toBe(false)
        })

        it('allows legitimate safe regex patterns with disjoint shorthands or non-nullable separators', () => {
            expect(isSafeUserRegex('foo.*bar')).toBe(true)
            expect(isSafeUserRegex('\\w+\\s*=\\s*\\d+')).toBe(true)
            expect(isSafeUserRegex('function\\s+\\w+\\(')).toBe(true)
            expect(isSafeUserRegex('a+b+c+')).toBe(true)
            expect(isSafeUserRegex('a{2,2}b{3,3}')).toBe(true)
        })
    })

    describe('M2: compactOversizedResult enforces cumulative node budget against DAG amplification', () => {
        it('aborts compaction cleanly on exponential shared-reference DAGs without hanging', () => {
            let node: Record<string, unknown> = { s: 'x'.repeat(200) }
            for (let d = 0; d < 6; d++) {
                const next: Record<string, unknown> = {}
                for (let k = 0; k < 50; k++) {
                    next[`k${String(k)}`] = node
                }
                node = next
            }

            const start = performance.now()
            expect(() => compactOversizedResult(node, 4096)).toThrow(/Compaction node budget exceeded/i)
            expect(performance.now() - start).toBeLessThan(1000)

            const sandboxResult: SandboxResult = {
                success: true,
                result: node,
                metrics: { wallTimeMs: 1, cpuTimeMs: 0, memoryUsedMb: 1 },
            }
            serializeAndEnforceEgress(sandboxResult, 4096)
            expect(sandboxResult.success).toBe(false)
            expect(sandboxResult.error).toContain('Output limit exceeded')
        })
    })

    describe('M3: snapshotUntrustedValue enforces pre-allocation array & key count budgets', () => {
        it('rejects sparse arrays and oversized primitive-key objects before allocation', async () => {
            const sparse = new Array<unknown>(1e8)
            const wideObj: Record<string, number> = {}
            for (let i = 0; i < 2_500; i++) {
                wideObj[`k${String(i)}`] = i
            }

            const exec = createSandboxExecutor({
                shimMj: {},
                vmContextRef: { current: undefined },
                timeoutMs: 5_000,
                readonlyMode: true,
                dryRunMode: false,
                useTestDbMode: false,
                runIsolatedNestedCode: vi.fn(),
                activeTimers: new Set(),
            })

            const sparseRes = (await exec({ code: 'return 1', context: { sparse } })) as {
                success?: boolean
                code?: string
                error?: string
            }
            expect(sparseRes.success).toBe(false)
            expect(sparseRes.code).toBe('VALIDATION_ERROR')
            expect(sparseRes.error).toMatch(/snapshot failed/i)

            const wideRes = (await exec({ code: 'return 1', context: wideObj })) as {
                success?: boolean
                code?: string
                error?: string
            }
            expect(wideRes.success).toBe(false)
            expect(wideRes.code).toBe('VALIDATION_ERROR')
            expect(wideRes.error).toMatch(/snapshot failed/i)
        })
    })

    describe('L1: validateOAuthTransportConfig rejects whitespace-only publicOrigin', () => {
        it('fails closed when publicOrigin is whitespace-only on loopback or non-loopback binds', () => {
            const logError = vi.fn()
            expect(() =>
                validateOAuthTransportConfig(
                    {
                        oauthEnabled: true,
                        oauthIssuer: 'https://auth.example.com',
                        oauthAudience: 'memory-journal-mcp',
                        publicOrigin: '   ',
                    },
                    '0.0.0.0',
                    false,
                    logError
                )
            ).toThrow(/whitespace-only/i)

            expect(() =>
                validateOAuthTransportConfig(
                    {
                        oauthEnabled: true,
                        oauthIssuer: 'https://auth.example.com',
                        oauthAudience: 'memory-journal-mcp',
                        publicOrigin: '\t ',
                    },
                    '127.0.0.1',
                    true,
                    logError
                )
            ).toThrow(/whitespace-only/i)
        })
    })

    describe('L2: json-entry-recovery caps title: and auto_context: candidate counts', () => {
        it('completes linearly when malformed payloads contain many unclosed title:/auto_context: fields', () => {
            const payload = `mj.core.createEntry({ content: 'ok', ${"title: '".repeat(2000)} ${'auto_context: {'.repeat(1000)} })`
            const start = performance.now()
            const recovered = extractAndRecoverEntryCode(payload)
            const elapsed = performance.now() - start
            expect(elapsed).toBeLessThan(200)
            expect(recovered).not.toBeNull()
        })
    })

    describe('L3: updateConfigurationSchema caps numeric briefing limits at 100', () => {
        it('rejects excessive briefing counts above 100 while accepting 0..100', () => {
            expect(updateConfigurationSchema.safeParse({ briefing_entries: 100 }).success).toBe(true)
            expect(updateConfigurationSchema.safeParse({ briefing_entries: 101 }).success).toBe(false)
            expect(updateConfigurationSchema.safeParse({ briefing_issues: 5000 }).success).toBe(false)
            expect(updateConfigurationSchema.safeParse({ briefing_workflows: 1000 }).success).toBe(false)
        })
    })

    describe('L4: assertSafeFilePath rejects trailing non-space whitespace in basenames', () => {
        it('rejects trailing tab or newline whitespace in file basenames', () => {
            const root = path.resolve(process.cwd())
            expect(() => assertSafeFilePath(path.join(root, 'note.md\t'), [root])).toThrow()
            expect(() => assertSafeFilePath(path.join(root, 'note.md%09'), [root])).toThrow()
        })
    })

    describe('AP1–AP3: Portable adversarial-security prompt revision & Pass 51 guidance', () => {
        it('bumps AUDIT_PROMPT_REVISION to 2026-11-20-audit-pass51 and includes Pass 51 guidance', () => {
            expect(AUDIT_PROMPT_REVISION).toBe('2026-11-21-audit-pass64')
            const def = getSecurityAuditPromptDefinition()
            const mockDb = {
                searchEntries: vi.fn().mockReturnValue([]),
                searchByDateRange: vi.fn().mockReturnValue([]),
                getRecentEntries: vi.fn().mockReturnValue([]),
            } as unknown as IDatabaseAdapter
            const rendered = def.handler({ target: 'memory-journal-mcp' }, mockDb)
            const text = rendered.messages[0]?.content.text ?? ''
            expect(text).toContain('Prompt revision: 2026-11-21-audit-pass64')
            expect(text).toContain('nullable separators')
            expect(text).toContain('sparse-array OOM')
            expect(text).toContain('exponential DAG amplification')
            expect(text).toContain('trimmed non-whitespace `publicOrigin`')
        })
    })
})
