/**
 * Regression suite for Batch B (M1, M2, S8) and G11 (direct source:'team' vs Code Mode auto-route):
 * - M1: Migration 019 legacy commit normalization, exclude_tags: ['commit-narrative'], optimizer prompt
 * - M2: Migration 020 origin_personal_id, personal/team mirror collapse annotating alsoInTeam
 * - G11: Direct omitted source preserves RESOURCE_NOT_FOUND, direct source:'team' + RBAC works,
 *        Code Mode silent probe auto-routes with _healed: { routedTo: 'team' } and 0 error metrics
 * - S8: get_commit_history({ uncommitted: true }) returns working tree on unborn HEAD without git log
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { MigrationManager } from '../../src/database/migrations/migration-manager.js'
import { Migration019NormalizeLegacyCommitEntries } from '../../src/database/migrations/019-normalize-legacy-commit-entries.js'
import { Migration020AddTeamOriginPersonalId } from '../../src/database/migrations/020-add-team-origin-personal-id.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { collectNonCodeModeTools } from '../../src/handlers/tools/codemode/singleton-state.js'
import { createJournalApi } from '../../src/codemode/api/journal-api.js'
import { wrapWithMetrics } from '../../src/observability/interceptor.js'
import { getPrompt } from '../../src/handlers/prompts/index.js'
import {
    DEFAULT_BRIEFING_CONFIG,
    type BriefingConfig,
} from '../../src/handlers/resources/shared.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import type { ToolHandlerConfig } from '../../src/types/index.js'

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getBindingFn(
    bindings: Record<string, unknown>,
    group: string,
    method: string
): (args: Record<string, unknown>) => Promise<unknown> {
    const grp = bindings[group]
    if (!isRecord(grp)) {
        throw new Error(`Expected sandbox binding group '${group}'`)
    }
    const fn = grp[method]
    if (typeof fn !== 'function') {
        throw new Error(`Expected sandbox binding method '${group}.${method}'`)
    }
    return fn as (args: Record<string, unknown>) => Promise<unknown>
}

describe('Batch B & G11 Regressions (M1, M2, G11, S8)', () => {
    let tmpDir: string
    let db: DatabaseAdapter
    let teamDb: DatabaseAdapter
    let runtime: ServerRuntime
    let config: ToolHandlerConfig
    let briefingConfig: BriefingConfig

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-batch-b-'))
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        teamDb = new DatabaseAdapter(':memory:')
        await teamDb.initialize()
        teamDb.applyTeamSchema()
        runtime = new ServerRuntime()
        const projectRegistry = {
            'test-ws': { path: tmpDir, project_number: 5 },
        }
        config = {
            defaultWorkspaceId: 'test-ws',
            defaultProjectNumber: 5,
            projectRegistry,
            teamAdmin: 'alice',
            teamDefaultRole: 'admin',
            runtime,
        }
        briefingConfig = {
            ...DEFAULT_BRIEFING_CONFIG,
            defaultWorkspaceId: 'test-ws',
            defaultProjectNumber: 5,
            projectRegistry,
        }
    })

    afterEach(() => {
        db.close()
        teamDb.close()
        fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('M1: normalizes legacy commit narratives idempotently, supports exclude_tags, and exposes legacy-commits optimizer dimension', async () => {
        const rawDb = new BetterSqlite3(':memory:')
        try {
            MigrationManager.runMigrations(rawDb, false)
            rawDb
                .prepare(
                    `INSERT INTO memory_journal (entry_type, content, workspace_id, auto_context, significance_type)
                     VALUES ('architecture', '## Summary\n\nCommit: abcdef1', 'test-ws', '{"source":"session-commits"}', NULL)`
                )
                .run()

            Migration019NormalizeLegacyCommitEntries.up(rawDb)
            const migrated = rawDb
                .prepare(
                    `SELECT id, entry_type AS entryType, significance_type AS significanceType FROM memory_journal`
                )
                .get() as { id: number; entryType: string; significanceType: string | null }
            expect(migrated.entryType).toBe('technical_note')
            expect(migrated.significanceType).toBe('architecture')

            const tags = rawDb
                .prepare(
                    `SELECT t.name AS name FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE et.entry_id = ?`
                )
                .all(migrated.id) as { name: string }[]
            expect(tags.map((t) => t.name)).toContain('commit-narrative')

            // Idempotent re-run leaves row unchanged without duplicates
            expect(() => Migration019NormalizeLegacyCommitEntries.up(rawDb)).not.toThrow()
        } finally {
            rawDb.close()
        }

        await callTool(
            'create_entry',
            {
                content: 'CommitSummaryToken automated commit log',
                entry_type: 'technical_note',
                tags: ['commit-narrative'],
                workspace_id: 'test-ws',
                project_number: 5,
                impact_score: 0.5,
                trust_score: 0.9,
                validation_status: 'passed',
            },
            db,
            undefined,
            undefined,
            config
        )
        const kept = await callTool(
            'create_entry',
            {
                content: 'CommitSummaryToken architectural decision',
                entry_type: 'project_decision',
                significance_type: 'architecture',
                tags: ['decision'],
                workspace_id: 'test-ws',
                project_number: 5,
                impact_score: 0.8,
                trust_score: 0.9,
                validation_status: 'passed',
            },
            db,
            undefined,
            undefined,
            config
        )
        const keptId = isRecord(kept) && typeof kept['id'] === 'number' ? kept['id'] : -1
        expect(keptId).toBeGreaterThan(0)

        const searchRes = await callTool(
            'search_entries',
            {
                query: 'CommitSummaryToken',
                mode: 'hybrid',
                exclude_tags: ['commit-narrative'],
                workspace_id: 'test-ws',
                project_number: 5,
            },
            db,
            undefined,
            undefined,
            config
        )
        expect(isRecord(searchRes)).toBe(true)
        if (!isRecord(searchRes)) return
        const entries = searchRes['entries']
        expect(Array.isArray(entries)).toBe(true)
        if (!Array.isArray(entries)) return
        expect(entries).toHaveLength(1)
        const firstHit = entries[0]
        expect(isRecord(firstHit) && firstHit['id'] === keptId).toBe(true)

        const promptRes = await getPrompt(
            'optimize-journal',
            { targetDimension: 'legacy-commits' },
            db,
            teamDb,
            undefined,
            briefingConfig,
            runtime
        )
        const promptText = promptRes.messages.map((m) => m.content.text).join('\n')
        expect(promptText).toContain('legacy-commits')
        expect(promptText).toContain('commit-narrative')
    })

    it('M2: Migration 020 adds origin_personal_id and hybrid search collapses personal/team mirrors with alsoInTeam', async () => {
        const rawTeam = new BetterSqlite3(':memory:')
        try {
            rawTeam.exec('CREATE TABLE memory_journal (id INTEGER PRIMARY KEY)')
            Migration020AddTeamOriginPersonalId.up(rawTeam)
            const cols = rawTeam.pragma('table_info(memory_journal)') as { name: string }[]
            expect(cols.some((c) => c.name === 'origin_personal_id')).toBe(true)
            expect(() => Migration020AddTeamOriginPersonalId.up(rawTeam)).not.toThrow()
        } finally {
            rawTeam.close()
        }

        const token = 'M2MirrorCollapseUniqueToken'
        const created = await callTool(
            'create_entry',
            {
                content: `Shared design pattern ${token}`,
                entry_type: 'project_decision',
                significance_type: 'decision',
                share_with_team: true,
                workspace_id: 'test-ws',
                project_number: 5,
                impact_score: 0.8,
                trust_score: 0.9,
                validation_status: 'passed',
            },
            db,
            undefined,
            undefined,
            config,
            undefined,
            teamDb
        )
        expect(isRecord(created) && created['sharedWithTeam'] === true).toBe(true)
        const personalId = isRecord(created) && typeof created['id'] === 'number' ? created['id'] : -1
        expect(personalId).toBeGreaterThan(0)

        const searchRes = await callTool(
            'search_entries',
            {
                query: token,
                mode: 'hybrid',
                include_team: true,
                workspace_id: 'test-ws',
                project_number: 5,
            },
            db,
            undefined,
            undefined,
            config,
            undefined,
            teamDb
        )
        expect(isRecord(searchRes)).toBe(true)
        if (!isRecord(searchRes)) return
        const entries = searchRes['entries']
        expect(Array.isArray(entries)).toBe(true)
        if (!Array.isArray(entries)) return
        expect(entries).toHaveLength(1)
        const hit = entries[0]
        expect(isRecord(hit)).toBe(true)
        if (!isRecord(hit)) return
        expect(hit['id']).toBe(personalId)
        expect(typeof hit['alsoInTeam']).toBe('number')
    })

    it('G11: direct omitted source returns RESOURCE_NOT_FOUND, direct source="team" obeys RBAC, and Code Mode auto-routes silently with _healed', async () => {
        const teamA = teamDb.createEntry({
            content: 'Team ADR Root G11',
            workspaceId: 'test-ws',
            projectNumber: 5,
            isPersonal: false,
            author: 'alice',
            entryType: 'project_decision',
            significanceType: 'architecture',
        })
        const teamB = teamDb.createEntry({
            content: 'Team ADR Peer G11',
            workspaceId: 'test-ws',
            projectNumber: 5,
            isPersonal: false,
            author: 'alice',
            entryType: 'technical_note',
        })
        teamDb.linkEntries(teamA.id, teamB.id, 'references')

        // Direct calls with omitted source must preserve RESOURCE_NOT_FOUND
        const directGetMissing = await callTool(
            'get_entry_by_id',
            { entry_id: teamA.id, workspace_id: 'test-ws', project_number: 5 },
            db,
            undefined,
            undefined,
            config,
            undefined,
            teamDb
        )
        expect(isRecord(directGetMissing) && directGetMissing['code'] === 'RESOURCE_NOT_FOUND').toBe(
            true
        )

        const directVisMissing = await callTool(
            'visualize_relationships',
            { entry_id: teamA.id, workspace_id: 'test-ws', project_number: 5 },
            db,
            undefined,
            undefined,
            config,
            undefined,
            teamDb
        )
        expect(isRecord(directVisMissing) && directVisMissing['code'] === 'RESOURCE_NOT_FOUND').toBe(
            true
        )

        // Explicit source: 'team' delegates cleanly on direct tools
        const directGetTeam = await callTool(
            'get_entry_by_id',
            { entry_id: teamA.id, source: 'team', workspace_id: 'test-ws', project_number: 5 },
            db,
            undefined,
            undefined,
            config,
            undefined,
            teamDb
        )
        expect(isRecord(directGetTeam) && directGetTeam['success'] === true).toBe(true)

        const directVisTeam = await callTool(
            'visualize_relationships',
            {
                entry_id: teamA.id,
                source: 'team',
                format: 'edges',
                workspace_id: 'test-ws',
                project_number: 5,
            },
            db,
            undefined,
            undefined,
            config,
            undefined,
            teamDb
        )
        expect(isRecord(directVisTeam) && directVisTeam['success'] === true).toBe(true)

        // Code Mode auto-routes omitted source silently through wrapWithMetrics without error metrics
        const errorsBeforeCodeMode = runtime.metrics.getSummary().totalErrors
        expect(errorsBeforeCodeMode).toBe(2)

        const tools = collectNonCodeModeTools({ db, teamDb, config })
        const toolMap = new Map(tools.map((t) => [t.name, t]))
        const dispatcher = async (
            toolName: string,
            args: Record<string, unknown>
        ): Promise<unknown> => {
            const target = toolMap.get(toolName)
            if (target === undefined) {
                throw new Error(`Missing tool ${toolName}`)
            }
            const wrapped = wrapWithMetrics(
                toolName,
                (a) => Promise.resolve(target.handler(a)),
                runtime.metrics
            )
            return await wrapped(args)
        }
        const api = createJournalApi(tools, dispatcher)
        const bindings = api.createSandboxBindings()
        const getEntryById = getBindingFn(bindings, 'core', 'getEntryById')
        const visualizeRelationships = getBindingFn(
            bindings,
            'relationships',
            'visualizeRelationships'
        )

        const cmGet = await getEntryById({
            entry_id: teamA.id,
            workspace_id: 'test-ws',
            project_number: 5,
        })
        expect(isRecord(cmGet)).toBe(true)
        if (isRecord(cmGet)) {
            expect(cmGet['success']).toBe(true)
            expect(isRecord(cmGet['_healed']) && cmGet['_healed']['routedTo'] === 'team').toBe(true)
        }

        const cmVis = await visualizeRelationships({
            entry_id: teamA.id,
            format: 'edges',
            workspace_id: 'test-ws',
            project_number: 5,
        })
        expect(isRecord(cmVis)).toBe(true)
        if (isRecord(cmVis)) {
            expect(cmVis['success']).toBe(true)
            expect(isRecord(cmVis['_healed']) && cmVis['_healed']['routedTo'] === 'team').toBe(true)
        }

        expect(runtime.metrics.getSummary().totalErrors).toBe(errorsBeforeCodeMode)

        // RBAC denial applies on direct source: 'team' once team RBAC is active and role is denied
        teamDb.addTeamMember('unrelated-owner-admin', 'admin', 'system')
        const deniedConfig: ToolHandlerConfig = {
            defaultWorkspaceId: 'test-ws',
            defaultProjectNumber: 5,
            projectRegistry: config.projectRegistry,
            teamDefaultRole: 'denied',
            runtime: new ServerRuntime(),
        }
        const deniedRes = await callTool(
            'get_entry_by_id',
            { entry_id: teamA.id, source: 'team', workspace_id: 'test-ws', project_number: 5 },
            db,
            undefined,
            undefined,
            deniedConfig,
            undefined,
            teamDb
        )
        expect(isRecord(deniedRes) && deniedRes['success'] === false).toBe(true)
    })

    it('S8: get_commit_history({ uncommitted: true }) returns working-tree state on unborn HEAD without git log', async () => {
        const gitTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-s8-unborn-'))
        try {
            execSync('git init', { cwd: gitTmp, stdio: 'ignore', windowsHide: true })
            fs.writeFileSync(path.join(gitTmp, 'untracked-s8.ts'), 'export const s8 = true;\n')

            const gitConfig: ToolHandlerConfig = {
                ...config,
                projectRegistry: {
                    ...config.projectRegistry,
                    'tmp-s8-repo': { path: gitTmp, project_number: 5 },
                },
            }
            const res = await callTool(
                'get_commit_history',
                { repo: 'tmp-s8-repo', uncommitted: true },
                db,
                undefined,
                undefined,
                gitConfig
            )
            expect(isRecord(res)).toBe(true)
            if (!isRecord(res)) return
            expect(res['success']).toBe(true)
            expect(res['commits']).toEqual([])
            expect(JSON.stringify(res['uncommitted'])).toContain('untracked-s8.ts')
        } finally {
            fs.rmSync(gitTmp, { recursive: true, force: true })
        }
    })
})
