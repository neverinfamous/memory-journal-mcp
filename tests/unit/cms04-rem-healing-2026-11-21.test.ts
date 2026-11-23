/**
 * CMS-04 REM Supervisor Regression Suite (2026-11-21)
 *
 * Covers the self-healing adaptations mined from CMS-02 (#15647), agent-issues.jsonl,
 * and mcp-audit.jsonl:
 * 1. Code Mode `dispatch-scope` excludes `check_entry_staleness`, `update_entry`, and
 *    `team_update_entry` from automatic top-level `session_id` injection while preserving
 *    explicit inner `session_id` and continuing auto-injection on `create_entry` / `team_create_entry`.
 * 2. `team_visualize_relationships` `limit` (1–500, >500 clamped to 500) schema & handler parity.
 * 3. `ValidationError` honoring explicit `details.suggestion` and `search_entries` empty-filter
 *    mitigation with `🛠️ AUTONOMOUS HEALING:` guidance toward `get_recent_entries`.
 * 4. `optimize-journal` prompt Team DB per-project enumeration guardrail covering
 *    `teamGetStatistics` and `teamListTags` alongside `teamGetRecent` / `teamGetEntryById`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { normalizeDispatchParams } from '../../src/handlers/tools/codemode/dispatch-scope.js'
import { getGitTools } from '../../src/handlers/tools/git.js'
import { getCoreTools } from '../../src/handlers/tools/core/tools.js'
import { getAdminTools } from '../../src/handlers/tools/admin/index.js'
import { getTeamTools } from '../../src/handlers/tools/team/index.js'
import { TeamVisualizeRelationshipsSchema } from '../../src/handlers/tools/team/schemas.js'
import { getOptimizerPromptDefinitions } from '../../src/handlers/prompts/optimizer.js'
import { ValidationError } from '../../src/types/errors.js'
import { formatHandlerError } from '../../src/utils/error-helpers.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import type { ToolContext, ToolDefinition, ToolHandlerConfig } from '../../src/types/index.js'

const TEST_REGISTRY: NonNullable<ToolHandlerConfig['projectRegistry']> = {
    'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
    companion: { path: process.cwd(), project_number: 16 },
}

function createConfig(): ToolHandlerConfig {
    return {
        projectRegistry: TEST_REGISTRY,
        runtime: new ServerRuntime(),
    }
}

function findTool(tools: readonly ToolDefinition[], name: string): ToolDefinition {
    const found = tools.find((t) => t.name === name)
    if (found === undefined) {
        throw new Error(`Expected tool '${name}' to be registered`)
    }
    return found
}

function extractNormalizedParams(
    outcome: Awaited<ReturnType<typeof normalizeDispatchParams>>
): Record<string, unknown> {
    if (!('params' in outcome) || typeof outcome.params !== 'object' || outcome.params === null) {
        throw new Error('Expected normalizeDispatchParams to succeed with a params record')
    }
    return outcome.params as Record<string, unknown>
}

describe('CMS-04 REM Healing (2026-11-21)', () => {
    let personalDb: DatabaseAdapter
    let teamDb: DatabaseAdapter

    beforeEach(async () => {
        personalDb = new DatabaseAdapter(':memory:')
        await personalDb.initialize()
        teamDb = new DatabaseAdapter(':memory:')
        await teamDb.initialize()
    })

    afterEach(() => {
        personalDb.close()
        teamDb.close()
    })

    describe('1. Code Mode session_id auto-injection exclusion for staleness and updates', () => {
        it('skips auto-injecting top-level session_id into check_entry_staleness, update_entry, and team_update_entry while keeping create_entry/team_create_entry and explicit inner session_id', async () => {
            const config = createConfig()
            const sessionContext: ToolContext = {
                db: personalDb,
                teamDb,
                config,
            }
            const dispatchCtx = {
                sessionContext,
                projectId: 5,
                workspaceId: 'memory-journal-mcp',
                explicitWorkspace: true,
                sessionId: 'sess-audit-run',
            }

            const stalenessTool = findTool(getGitTools(sessionContext), 'check_entry_staleness')
            const updateTool = findTool(getAdminTools(sessionContext), 'update_entry')
            const teamUpdateTool = findTool(getTeamTools(sessionContext), 'team_update_entry')
            const createTool = findTool(getCoreTools(sessionContext), 'create_entry')
            const teamCreateTool = findTool(getTeamTools(sessionContext), 'team_create_entry')

            // Excluded tools: omitted inner session_id stays undefined
            const stalenessOmitted = extractNormalizedParams(
                await normalizeDispatchParams(stalenessTool, { workspace_id: '*' }, dispatchCtx)
            )
            expect(stalenessOmitted['session_id']).toBeUndefined()

            const updateOmitted = extractNormalizedParams(
                await normalizeDispatchParams(
                    updateTool,
                    { entry_id: 1, tags: ['calibrated'] },
                    dispatchCtx
                )
            )
            expect(updateOmitted['session_id']).toBeUndefined()

            const teamUpdateOmitted = extractNormalizedParams(
                await normalizeDispatchParams(
                    teamUpdateTool,
                    { entry_id: 1, workspace_id: 'companion', project_number: 16, tags: ['calibrated'] },
                    dispatchCtx
                )
            )
            expect(teamUpdateOmitted['session_id']).toBeUndefined()

            // Explicit inner session_id is still honored on excluded tools
            const stalenessExplicit = extractNormalizedParams(
                await normalizeDispatchParams(
                    stalenessTool,
                    { workspace_id: 'memory-journal-mcp', session_id: 'sess-explicit' },
                    dispatchCtx
                )
            )
            expect(stalenessExplicit['session_id']).toBe('sess-explicit')

            const updateExplicit = extractNormalizedParams(
                await normalizeDispatchParams(
                    updateTool,
                    { entry_id: 1, session_id: 'sess-explicit' },
                    dispatchCtx
                )
            )
            expect(updateExplicit['session_id']).toBe('sess-explicit')

            // Create tools still inherit top-level session_id automatically
            const createNorm = extractNormalizedParams(
                await normalizeDispatchParams(
                    createTool,
                    { content: 'Session-tagged note' },
                    dispatchCtx
                )
            )
            expect(createNorm['session_id']).toBe('sess-audit-run')

            const teamCreateNorm = extractNormalizedParams(
                await normalizeDispatchParams(
                    teamCreateTool,
                    { content: 'Team session-tagged note' },
                    dispatchCtx
                )
            )
            expect(teamCreateNorm['session_id']).toBe('sess-audit-run')
        })

        it('preserves original entry sessionId when update_entry runs via Code Mode dispatch', async () => {
            const config = createConfig()
            const seeded = personalDb.createEntry({
                content: 'Historical entry owned by original session',
                entryType: 'technical_note',
                workspaceId: 'memory-journal-mcp',
                projectNumber: 5,
                sessionId: 'sess-original-owner',
            })

            const updateTool = findTool(
                getAdminTools({ db: personalDb, teamDb, config }),
                'update_entry'
            )
            const normalized = extractNormalizedParams(
                await normalizeDispatchParams(
                    updateTool,
                    { entry_id: seeded.id, validation_status: 'passed' },
                    {
                        sessionContext: { db: personalDb, teamDb, config },
                        projectId: 5,
                        workspaceId: 'memory-journal-mcp',
                        explicitWorkspace: true,
                        sessionId: 'sess-nrem-audit',
                    }
                )
            )
            const res = (await callTool(
                'update_entry',
                normalized,
                personalDb,
                undefined,
                undefined,
                config,
                undefined,
                teamDb
            )) as { success: boolean; entry?: { sessionId?: string | null } }
            expect(res.success).toBe(true)
            expect(res.entry?.sessionId).toBe('sess-original-owner')
        })
    })

    describe('2. team_visualize_relationships limit parity', () => {
        it('accepts, coerces, and clamps limit (1-500) in TeamVisualizeRelationshipsSchema while rejecting invalid values and unknown keys', () => {
            expect(
                TeamVisualizeRelationshipsSchema.parse({
                    project_number: 16,
                    limit: 500,
                }).limit
            ).toBe(500)
            expect(
                TeamVisualizeRelationshipsSchema.parse({
                    project_number: 16,
                    limit: '25',
                }).limit
            ).toBe(25)
            expect(
                TeamVisualizeRelationshipsSchema.parse({
                    project_number: 16,
                    limit: 999,
                }).limit
            ).toBe(500)
            expect(
                TeamVisualizeRelationshipsSchema.parse({
                    project_number: 16,
                    limit: '750',
                }).limit
            ).toBe(500)
            expect(
                TeamVisualizeRelationshipsSchema.parse({
                    project_number: 16,
                }).limit
            ).toBeUndefined()

            expect(
                TeamVisualizeRelationshipsSchema.safeParse({ project_number: 16, limit: 0 }).success
            ).toBe(false)
            expect(
                TeamVisualizeRelationshipsSchema.safeParse({ project_number: 16, limit: -5 }).success
            ).toBe(false)
            expect(
                TeamVisualizeRelationshipsSchema.safeParse({ project_number: 16, limit: 'abc' }).success
            ).toBe(false)
            expect(
                TeamVisualizeRelationshipsSchema.safeParse({ project_number: 16, unknown_key: 1 })
                    .success
            ).toBe(false)
        })

        it('applies limit across recent, tag, and entry_id modes in team_visualize_relationships', async () => {
            const config = createConfig()
            const e1 = teamDb.createEntry({
                content: 'Team node 1',
                entryType: 'technical_note',
                workspaceId: 'companion',
                projectNumber: 16,
                tags: ['graph-limit'],
            })
            const e2 = teamDb.createEntry({
                content: 'Team node 2',
                entryType: 'technical_note',
                workspaceId: 'companion',
                projectNumber: 16,
                tags: ['graph-limit'],
            })
            const e3 = teamDb.createEntry({
                content: 'Team node 3',
                entryType: 'technical_note',
                workspaceId: 'companion',
                projectNumber: 16,
                tags: ['graph-limit'],
            })
            teamDb.linkEntries(e1.id, e2.id, 'references')
            teamDb.linkEntries(e2.id, e3.id, 'evolves_from')

            const recentLimited = (await callTool(
                'team_visualize_relationships',
                { workspace_id: 'companion', project_number: 16, limit: 2 },
                personalDb,
                undefined,
                undefined,
                config,
                undefined,
                teamDb
            )) as { success: boolean; nodeCount: number }
            expect(recentLimited.success).toBe(true)
            expect(recentLimited.nodeCount).toBe(2)

            const tagLimited = (await callTool(
                'team_visualize_relationships',
                { workspace_id: 'companion', project_number: 16, tag: 'graph-limit', limit: 2 },
                personalDb,
                undefined,
                undefined,
                config,
                undefined,
                teamDb
            )) as { success: boolean; nodeCount: number }
            expect(tagLimited.success).toBe(true)
            expect(tagLimited.nodeCount).toBe(2)

            const neighborhoodLimited = (await callTool(
                'team_visualize_relationships',
                { workspace_id: 'companion', project_number: 16, entry_id: e1.id, depth: 2, limit: 2 },
                personalDb,
                undefined,
                undefined,
                config,
                undefined,
                teamDb
            )) as { success: boolean; nodeCount: number; edgeCount: number }
            expect(neighborhoodLimited.success).toBe(true)
            expect(neighborhoodLimited.nodeCount).toBe(2)
            expect(neighborhoodLimited.edgeCount).toBe(1)

            const neighborhoodUnbounded = (await callTool(
                'team_visualize_relationships',
                { workspace_id: 'companion', project_number: 16, entry_id: e1.id, depth: 2 },
                personalDb,
                undefined,
                undefined,
                config,
                undefined,
                teamDb
            )) as { success: boolean; nodeCount: number; edgeCount: number }
            expect(neighborhoodUnbounded.success).toBe(true)
            expect(neighborhoodUnbounded.nodeCount).toBe(3)
            expect(neighborhoodUnbounded.edgeCount).toBe(2)
        })
    })

    describe('3. ValidationError explicit suggestion & search_entries empty-filter hint', () => {
        it('honors details.suggestion on ValidationError while preserving default fallback', () => {
            const explicitErr = new ValidationError('Bad payload', {
                suggestion: '🛠️ AUTONOMOUS HEALING: Use explicit fields.',
            })
            expect(explicitErr.hasExplicitSuggestion).toBe(true)
            expect(explicitErr.suggestion).toBe('🛠️ AUTONOMOUS HEALING: Use explicit fields.')
            const formattedExplicit = formatHandlerError(explicitErr) as { suggestion?: string }
            expect(formattedExplicit.suggestion).toBe('🛠️ AUTONOMOUS HEALING: Use explicit fields.')

            const defaultErr = new ValidationError('Generic bad payload')
            expect(defaultErr.hasExplicitSuggestion).toBe(false)
            expect(defaultErr.suggestion).toBe('Check input parameters against the tool schema')
        })

        it('returns AUTONOMOUS HEALING hint when search_entries has no query and only default workspace_id', async () => {
            const config = createConfig()
            const res = (await callTool(
                'search_entries',
                { workspace_id: 'default', limit: 20 },
                personalDb,
                undefined,
                undefined,
                config
            )) as { success: boolean; code?: string; error?: string; suggestion?: string }
            expect(res.success).toBe(false)
            expect(res.code).toBe('VALIDATION_ERROR')
            expect(res.error).toContain('Search requires either a query string or at least one filter')
            expect(res.suggestion).toContain('🛠️ AUTONOMOUS HEALING:')
            expect(res.suggestion).toContain('get_recent_entries')
        })
    })

    describe('4. optimize-journal prompt Team DB wildcard guidance', () => {
        it('lists teamGetStatistics and teamListTags alongside teamGetRecent and teamGetEntryById', () => {
            const prompts = getOptimizerPromptDefinitions()
            const optimize = prompts.find((p) => p.name === 'optimize-journal')
            if (optimize === undefined) {
                throw new Error('optimize-journal prompt not found')
            }
            const output = optimize.handler({ mode: 'full', autoRun: 'true' }, personalDb, teamDb, undefined, {
                projectRegistry: TEST_REGISTRY,
            })
            const text = output.messages
                .map((m) => m.content.text ?? '')
                .join('\n')
            expect(text).toContain("`teamGetRecent`/`teamGetStatistics`/`teamListTags`/`teamGetEntryById`")
        })
    })
})
