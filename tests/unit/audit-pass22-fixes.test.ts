/**
 * Pass 22 Adversarial Code Quality Audit Regression Tests
 *
 * Covers Pass 22 fixes:
 * - M9: Tool filter leading exclude + explicit include (-starter,+create_entry)
 * - H17: memory://agent-id alias preserves active session/CWD/default resolution
 * - C13/H22: Workflow & adversarial prompt scope isolation (#12 / unmatched target)
 * - H23/L8: Optimizer & CMS supervisor dynamic project_number and target sanitization
 * - M6: Staleness resource ambiguous project_number guard
 * - L5: OAuth error formatter requiredScope array narrowing
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import {
    parseToolFilter,
    getAllToolNames,
    ALWAYS_ENABLED_TOOLS,
} from '../../src/filtering/tool-filter.js'
import { readResource } from '../../src/handlers/resources/index.js'
import type { BriefingConfig } from '../../src/handlers/resources/shared.js'
import { getPrompt } from '../../src/handlers/prompts/index.js'
import { getWorkflowPromptDefinitions } from '../../src/handlers/prompts/workflow.js'
import { InsufficientScopeError } from '../../src/auth/errors.js'
import { formatOAuthError } from '../../src/auth/transport-agnostic.js'

function createBaseBriefingConfig(overrides: Partial<BriefingConfig> = {}): BriefingConfig {
    return {
        commitCount: 3,
        entryCount: 3,
        includeTeam: false,
        issueCount: 0,
        prCount: 0,
        prStatusBreakdown: false,
        workflowCount: 0,
        workflowStatusBreakdown: false,
        copilotReviews: false,
        ...overrides,
    }
}

describe('Pass 22 Adversarial Code Quality Audit Fixes', () => {
    let db: DatabaseAdapter

    beforeAll(async () => {
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        db.createEntry({
            content: 'Pass 22 regression test baseline entry',
            tags: ['pass-22'],
        })
    })

    afterAll(() => {
        db.close()
    })

    describe('M9: Tool filter exclude-first with re-include', () => {
        it('seeds all tools on leading exclude and preserves explicit +create_entry', () => {
            const alwaysEnabled = new Set(ALWAYS_ENABLED_TOOLS)
            const starterTools = parseToolFilter('starter').enabledTools
            const excludedStarterTool = Array.from(starterTools).find(
                (name) => name !== 'create_entry' && !alwaysEnabled.has(name)
            )
            expect(excludedStarterTool).toBeDefined()

            const nonStarterTool = getAllToolNames().find(
                (name) => !starterTools.has(name) && !alwaysEnabled.has(name)
            )
            expect(nonStarterTool).toBeDefined()

            const filtered = parseToolFilter('-starter,+create_entry')
            expect(filtered.enabledTools.has('create_entry')).toBe(true)
            if (excludedStarterTool !== undefined) {
                expect(filtered.enabledTools.has(excludedStarterTool)).toBe(false)
            }
            if (nonStarterTool !== undefined) {
                expect(filtered.enabledTools.has(nonStarterTool)).toBe(true)
            }
        })
    })

    describe('H17: memory://agent-id alias URI preservation', () => {
        it('does not collapse memory://agent-id into memory://agent-context/default', async () => {
            const briefingConfig = createBaseBriefingConfig({
                defaultWorkspaceId: 'alpha-proj',
                defaultProjectNumber: 42,
                projectRegistry: {
                    'alpha-proj': {
                        path: '/tmp/alpha-proj',
                        project_number: 42,
                    },
                },
            })

            const result = await readResource(
                'memory://agent-id',
                db,
                undefined,
                null,
                null,
                undefined,
                briefingConfig
            )

            expect(typeof result.data).toBe('string')
            const text = String(result.data)
            expect(text).toContain('Workspace ID: alpha-proj')
            expect(text).toContain('Project Number: 42')
            expect(text).not.toContain('Workspace ID: default')
        })
    })

    describe('C13/H22: Workflow & adversarial prompt scope isolation', () => {
        const scopedConfig = createBaseBriefingConfig({
            defaultWorkspaceId: 'default-repo',
            defaultProjectNumber: 5,
            projectRegistry: {
                'default-repo': {
                    path: '/tmp/default-repo',
                    project_number: 5,
                },
                'repo-twelve': {
                    path: '/tmp/repo-twelve',
                    project_number: 12,
                },
            },
        })

        it('does not leak default workspace or project #5 on unmatched #99 target', async () => {
            const result = await getPrompt(
                'adversarial-audit-code-quality',
                { target: '#99' },
                db,
                undefined,
                undefined,
                scopedConfig
            )
            const text = result.messages[0]?.content.text ?? ''
            expect(text).not.toContain('workspace_id: "default-repo"')
            expect(text).not.toContain('project_number: 5')
        })

        it('isolates workflow prompts on #12 vs unmatched project args without leaking default scope', async () => {
            const workflowDefs = getWorkflowPromptDefinitions()
            const summaryDef = workflowDefs.find((p) => p.name === 'session-summary')
            expect(summaryDef).toBeDefined()

            const matchedTextResult = await getPrompt(
                'session-summary',
                { project_number: '12' },
                db,
                undefined,
                undefined,
                scopedConfig
            )
            const matchedText = matchedTextResult.messages[0]?.content.text ?? ''
            expect(matchedText).toContain('repo-twelve')
            expect(matchedText).toContain('project_number: 12')
            expect(matchedText).not.toContain('workspace_id: "default-repo"')
            expect(matchedText).not.toContain('project_number: 5')

            const spySearchEntries = vi.fn().mockReturnValue({ entries: [] })
            const spyRecent = vi.fn().mockReturnValue({ entries: [] })
            const spyDb = {
                searchEntries: spySearchEntries,
                getRecentEntries: spyRecent,
                searchByDateRange: vi.fn().mockReturnValue({ entries: [] }),
                getStatistics: vi.fn().mockReturnValue({ totalEntries: 0 }),
                getSignificantEntries: vi.fn().mockReturnValue([]),
                getRecentGraphRelationships: vi.fn().mockReturnValue([]),
                getWorkflowActionEntries: vi.fn().mockReturnValue([]),
                getAuthorStatistics: vi.fn().mockReturnValue([]),
                getAuthorsForEntries: vi.fn().mockReturnValue(new Map()),
            }

            const unmatchedRes = await summaryDef?.handler(
                { workspace_id: 'nonexistent-proj' },
                spyDb as never,
                undefined,
                undefined,
                scopedConfig
            )
            const unmatchedText = unmatchedRes?.messages[0]?.content.text ?? ''
            expect(unmatchedText).not.toContain('workspace_id: "default-repo"')
            expect(unmatchedText).not.toContain('project_number: 5')

            const allCalls = [...spySearchEntries.mock.calls, ...spyRecent.mock.calls]
            for (const callArgs of allCalls) {
                const serialized = JSON.stringify(callArgs)
                expect(serialized).not.toContain('default-repo')
                expect(serialized).not.toContain('"projectNumber":5')
            }
        })
    })

    describe('H23/L8: Optimizer and CMS supervisor dynamic project_number and target sanitization', () => {
        const customRegistryConfig = createBaseBriefingConfig({
            projectRegistry: {
                'memory-journal-mcp': {
                    path: '/tmp/memory-journal-mcp',
                    project_number: 77,
                },
            },
        })

        it('uses registry project_number for optimize-journal and sanitizes targetProject', async () => {
            const res = await getPrompt(
                'optimize-journal',
                { project: 'safe-repo`\n## Injected Heading\r\nmalicious' },
                db,
                undefined,
                undefined,
                customRegistryConfig
            )
            const text = res.messages[0]?.content.text ?? ''
            expect(text).toContain('project_number: 77')
            expect(text).not.toContain('project_number: 5')
            expect(text).not.toContain('\n## Injected Heading')
            expect(text).toContain("**Target Project**: `safe-repo' ## Injected Heading malicious`")
        })

        it('uses registry project_number for cms-rem-supervisor', async () => {
            const res = await getPrompt(
                'cms-rem-supervisor',
                {},
                db,
                undefined,
                undefined,
                customRegistryConfig
            )
            const text = res.messages[0]?.content.text ?? ''
            expect(text).toContain('project_number: 77')
            expect(text).not.toContain('project_number: 5')
        })
    })

    describe('M6: Staleness ambiguous project check', () => {
        it('returns an explicit error when multiple workspaces share the queried project_number', async () => {
            const ambiguousConfig = createBaseBriefingConfig({
                projectRegistry: {
                    'repo-alpha': { path: '/tmp/repo-alpha', project_number: 42 },
                    'repo-beta': { path: '/tmp/repo-beta', project_number: 42 },
                },
            })

            const result = await readResource(
                'memory://staleness/42',
                db,
                undefined,
                null,
                null,
                undefined,
                ambiguousConfig
            )

            expect(typeof result.data).toBe('object')
            expect(result.data).not.toBeNull()
            if (typeof result.data === 'object' && result.data !== null && 'error' in result.data) {
                expect(typeof result.data.error).toBe('string')
                expect(String(result.data.error).toLowerCase()).toMatch(/ambiguous|multiple/)
            } else {
                expect.unreachable('Expected error field in staleness response')
            }
        })
    })

    describe('L5: OAuth error formatter requiredScope array narrowing', () => {
        it('handles string arrays and filters non-string or non-array requiredScope details safely', () => {
            const validErr = new InsufficientScopeError(['entries:read', 'entries:write'])
            const validFormatted = formatOAuthError(validErr)
            expect(validFormatted.status).toBe(403)
            expect(validFormatted.body).toHaveProperty('error', 'insufficient_scope')

            const mixedErr = new InsufficientScopeError('admin')
            Object.defineProperty(mixedErr, 'details', {
                value: { requiredScope: ['admin', 123, null] },
                configurable: true,
            })
            const mixedFormatted = formatOAuthError(mixedErr)
            expect(mixedFormatted.status).toBe(403)

            const nonArrayErr = new InsufficientScopeError('admin')
            Object.defineProperty(nonArrayErr, 'details', {
                value: { requiredScope: 'not-an-array' },
                configurable: true,
            })
            const nonArrayFormatted = formatOAuthError(nonArrayErr)
            expect(nonArrayFormatted.status).toBe(403)
        })
    })
})
