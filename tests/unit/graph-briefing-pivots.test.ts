/**
 * Regression suite for Batch C graph/briefing integration (G1-G9),
 * opt-out controls, G6 team mirror dedup, memory://graph/{+repo},
 * memory://agent-context?session_id=, compact visualize_relationships,
 * and create_entry / dry-run suggested_links.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { ProtocolError } from '@modelcontextprotocol/server'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { readResource } from '../../src/handlers/resources/index.js'
import {
    DEFAULT_BRIEFING_CONFIG,
    type BriefingConfig,
} from '../../src/handlers/resources/shared.js'
import {
    buildGraphPivots,
    resolveBriefingToolNaming,
    resolveToolHintName,
} from '../../src/handlers/resources/core/briefing/graph-pivots-section.js'
import { previewDraftSuggestedLinks } from '../../src/handlers/tools/core/link-suggestions.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { getActiveSessionProject } from '../../src/utils/workspace-resolver.js'
import type { ToolHandlerConfig } from '../../src/types/index.js'

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unwrapCreatedId(result: unknown): number {
    if (!isRecord(result) || result['success'] !== true) {
        throw new Error(`Expected create_entry success, got: ${JSON.stringify(result)}`)
    }
    const id = result['id']
    if (typeof id !== 'number') {
        throw new Error(`Expected numeric id on create_entry result, got: ${JSON.stringify(result)}`)
    }
    return id
}

function unwrapLinkSuccess(result: unknown): void {
    if (!isRecord(result) || result['success'] !== true) {
        throw new Error(`Expected link_entries success, got: ${JSON.stringify(result)}`)
    }
}

describe('Graph & Briefing Integration (G1-G9)', () => {
    let tmpDir: string
    let db: DatabaseAdapter
    let teamDb: DatabaseAdapter
    let runtime: ServerRuntime
    let config: ToolHandlerConfig
    let briefingConfig: BriefingConfig

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-graph-pivots-'))
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
            entryCount: 5,
            projectRegistry,
        }
    })

    afterEach(() => {
        db.close()
        teamDb.close()
        fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    async function seedEntry(
        content: string,
        extra: Record<string, unknown> = {}
    ): Promise<number> {
        const res = await callTool(
            'create_entry',
            {
                content,
                entry_type: 'technical_note',
                workspace_id: 'test-ws',
                project_number: 5,
                impact_score: 0.7,
                trust_score: 0.9,
                validation_status: 'passed',
                ...extra,
            },
            db,
            undefined,
            undefined,
            config,
            undefined,
            teamDb
        )
        return unwrapCreatedId(res)
    }

    it('renders briefing graph pivots by default (degrees, 14d unlinked warning, active threads, neighborhood) and respects graphPivots=false', async () => {
        expect(DEFAULT_BRIEFING_CONFIG.graphPivots).toBe(true)

        const e1 = await seedEntry('Architecture Hub Alpha decision')
        const e2 = await seedEntry('Child note Beta referencing alpha')
        const e3 = await seedEntry('Child note Gamma referencing alpha')
        const e4 = await seedEntry('Orphan note Delta')
        const e5 = await seedEntry('Orphan note Epsilon')

        unwrapLinkSuccess(
            await callTool(
                'link_entries',
                {
                    from_entry_id: e1,
                    to_entry_id: e2,
                    relationship_type: 'evolves_from',
                    workspace_id: 'test-ws',
                    project_number: 5,
                },
                db,
                undefined,
                undefined,
                config
            )
        )
        unwrapLinkSuccess(
            await callTool(
                'link_entries',
                {
                    from_entry_id: e1,
                    to_entry_id: e3,
                    relationship_type: 'references',
                    workspace_id: 'test-ws',
                    project_number: 5,
                },
                db,
                undefined,
                undefined,
                config
            )
        )

        const defaultRes = await readResource(
            'memory://briefing/test-ws',
            db,
            undefined,
            undefined,
            undefined,
            teamDb,
            briefingConfig,
            runtime
        )
        expect(typeof defaultRes.data).toBe('string')
        const defaultMd = String(defaultRes.data)
        expect(defaultMd).toContain('↔2')
        expect(defaultMd).toContain('↔1')
        expect(defaultMd).toContain('⚪')
        expect(defaultMd).toContain('Unlinked (14d): 2/5 ⚠️')
        expect(defaultMd).toContain('Active threads (14d):')
        expect(defaultMd).toContain(`#${String(e1)}`)
        expect(defaultMd).toContain('Neighborhood: `memory://graph/test-ws`')

        // Opt-out via graphPivots: false restores legacy Context Hubs row
        const optOutRes = await readResource(
            'memory://briefing/test-ws',
            db,
            undefined,
            undefined,
            undefined,
            teamDb,
            { ...briefingConfig, graphPivots: false },
            runtime
        )
        const optOutMd = String(optOutRes.data)
        expect(optOutMd).toContain('Context Hubs:')
        expect(optOutMd).not.toContain('Active threads (14d):')
        expect(optOutMd).not.toContain('Unlinked (14d):')
        expect(optOutMd).not.toContain('Neighborhood: `memory://graph/')
        expect(optOutMd).not.toContain('↔')
        expect(optOutMd).not.toContain('⚪')
        expect(e4).toBeGreaterThan(0)
        expect(e5).toBeGreaterThan(0)
    })

    it('resolves commitRefs to earliest auto_context entry and detects codemode tool naming', async () => {
        const first = await seedEntry('Commit narrative earliest', {
            auto_context: JSON.stringify({ commits: ['abcdef1234567890'] }),
        })
        const second = await seedEntry('Later retrospective referencing commit', {
            entry_type: 'retrospective',
            auto_context: JSON.stringify({ commits: ['abcdef1234567890'] }),
        })

        const pivots = buildGraphPivots(
            { db, runtime, briefingConfig },
            'test-ws',
            [first, second],
            ['abcdef1']
        )
        expect(pivots).toBeDefined()
        expect(Object.getPrototypeOf(pivots?.degrees)).toBeNull()
        expect(Object.getPrototypeOf(pivots?.commitRefs)).toBeNull()
        expect(pivots?.commitRefs['abcdef1']).toBe(first)

        const naming = resolveBriefingToolNaming({
            raw: 'codemode-only',
            rules: [],
            enabledTools: new Set(['mj_execute_code']),
        })
        expect(naming).toBe('codemode')
    })

    it('G6: deduplicates shared personal/team mirrors in briefing while keeping distinct team entries', async () => {
        const sharedMarker = 'UNIQUE_MIRRORED_ENTRY_G6'
        const distinctMarker = 'DISTINCT_TEAM_ONLY_ENTRY_G6'

        await seedEntry(`Shared note ${sharedMarker}`, {
            share_with_team: true,
        })

        teamDb.createEntry({
            content: `Teammate note ${distinctMarker}`,
            workspaceId: 'test-ws',
            projectNumber: 5,
            isPersonal: false,
            author: 'teammate',
            entryType: 'technical_note',
        })

        const res = await readResource(
            'memory://briefing/test-ws',
            db,
            undefined,
            undefined,
            undefined,
            teamDb,
            { ...briefingConfig, includeTeam: true },
            runtime
        )
        const md = String(res.data)
        expect(md).toContain(distinctMarker)
        expect(md.split(sharedMarker).length - 1).toBe(1)
    })

    it('renders compact markdown memory://graph/{+repo} and memory://agent-context/{+repo}?session_id=', async () => {
        const e1 = await seedEntry('Graph node One', { session_id: 'sess-ctx-1' })
        const e2 = await seedEntry('Graph node Two', { session_id: 'sess-ctx-1' })
        const e3 = await seedEntry('Unlinked node Three')

        unwrapLinkSuccess(
            await callTool(
                'link_entries',
                {
                    from_entry_id: e1,
                    to_entry_id: e2,
                    relationship_type: 'evolves_from',
                    workspace_id: 'test-ws',
                    project_number: 5,
                },
                db,
                undefined,
                undefined,
                config
            )
        )

        const graphRes = await readResource(
            'memory://graph/test-ws?days=14&limit=40',
            db,
            undefined,
            undefined,
            undefined,
            teamDb,
            briefingConfig,
            runtime
        )
        const graphMd = String(graphRes.data)
        expect(graphMd).toContain('# Graph neighborhood · test-ws · last 14d')
        expect(graphMd).toContain('## Nodes')
        expect(graphMd).toContain('## Edges')
        expect(graphMd).toContain(`#${String(e1)} -evolves_from-> #${String(e2)}`)
        expect(graphMd).toContain('## Unlinked (14d)')
        expect(graphMd).toContain(`#${String(e3)}`)

        const ctxRes = await readResource(
            'memory://agent-context/test-ws?session_id=sess-ctx-1',
            db,
            undefined,
            undefined,
            undefined,
            teamDb,
            briefingConfig,
            runtime
        )
        const ctxText = String(ctxRes.data)
        expect(ctxText).toContain('Workspace ID: test-ws')
        expect(ctxText).toContain('Session Entries (newest first; link targets):')
        expect(ctxText).toContain(`#${String(e1)}`)
        expect(ctxText).toContain(`#${String(e2)}`)
    })

    it('truncates long bodies and omits Mermaid clutter on visualize_relationships with include_content=false and format=edges', async () => {
        const longBody =
            'Prefix summary of architectural decision that keeps going well past one hundred twenty characters to verify preview truncation behavior. ' +
            'TAIL_BEYOND_120_MARKER'
        const a = await seedEntry(longBody)
        const b = await seedEntry('Target node short content')
        unwrapLinkSuccess(
            await callTool(
                'link_entries',
                {
                    from_entry_id: a,
                    to_entry_id: b,
                    relationship_type: 'references',
                    workspace_id: 'test-ws',
                    project_number: 5,
                },
                db,
                undefined,
                undefined,
                config
            )
        )

        const visRes = await callTool(
            'visualize_relationships',
            {
                entry_id: a,
                include_content: false,
                format: 'edges',
                workspace_id: 'test-ws',
                project_number: 5,
            },
            db,
            undefined,
            undefined,
            config
        )
        expect(isRecord(visRes)).toBe(true)
        if (isRecord(visRes)) {
            expect(visRes['entry_count']).toBe(2)
            expect(visRes['relationship_count']).toBe(1)
            expect(Array.isArray(visRes['nodes'])).toBe(true)
            expect(Array.isArray(visRes['edges'])).toBe(true)
            expect(visRes['mermaid']).toBeUndefined()
        }
        const serialized = JSON.stringify(visRes)
        expect(serialized).not.toContain('TAIL_BEYOND_120_MARKER')
        expect(serialized).not.toContain('graph TD')
        expect(serialized).not.toContain('Legend')
    })

    it('G9: returns suggested_links on create_entry and previewDraftSuggestedLinks for same-session and shared-anchor peers', async () => {
        const prior = await seedEntry('Anchor module refactor plan', {
            session_id: 'sess-g9',
            anchors: [{ anchor_path: 'src/alpha.ts', anchor_type: 'file' }],
        })

        const draftBySession = previewDraftSuggestedLinks({
            db,
            workspaceId: 'test-ws',
            projectNumber: 5,
            sessionId: 'sess-g9',
            anchors: [{ anchor_path: 'src/alpha.ts' }],
        })
        expect(draftBySession.some((s) => s.targetId === prior && s.reason === 'same-session')).toBe(
            true
        )

        const draftByAnchorOnly = previewDraftSuggestedLinks({
            db,
            workspaceId: 'test-ws',
            projectNumber: 5,
            sessionId: 'different-session',
            anchors: [{ anchor_path: 'src/alpha.ts' }],
        })
        expect(
            draftByAnchorOnly.some((s) => s.targetId === prior && s.reason === 'shared-anchor')
        ).toBe(true)

        const created = await callTool(
            'create_entry',
            {
                content: 'Follow-up note without explicit relationships',
                entry_type: 'technical_note',
                workspace_id: 'test-ws',
                project_number: 5,
                session_id: 'sess-g9',
                impact_score: 0.7,
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
        expect(isRecord(created)).toBe(true)
        if (!isRecord(created)) return
        const suggestions = created['suggested_links']
        expect(Array.isArray(suggestions)).toBe(true)
        if (!Array.isArray(suggestions)) return
        expect(
            suggestions.some(
                (s) => isRecord(s) && s['targetId'] === prior && s['reason'] === 'same-session'
            )
        ).toBe(true)
    })

    it('ranks fresh inbound-convergent active threads above bulk outbound consolidation hubs pointing to old entries and displays (+N)', async () => {
        const rawDb = (
            db as unknown as {
                connection: {
                    getNativeDb: () => {
                        prepare: (sql: string) => { run: (...args: unknown[]) => void }
                    }
                }
            }
        ).connection.getNativeDb()
        const oldTs = '2026-01-01T00:00:00.000Z'
        const oldTargets: number[] = []
        for (let i = 0; i < 6; i++) {
            const id = await seedEntry(`Historical note ${String(i)}`)
            rawDb.prepare('UPDATE memory_journal SET timestamp = ? WHERE id = ?').run(oldTs, id)
            oldTargets.push(id)
        }
        const consolidationHub = await seedEntry('Bulk consolidation summary')
        for (const target of oldTargets) {
            db.linkEntries(consolidationHub, target, 'evolves_from', undefined, 'test-ws')
        }

        const freshThread = await seedEntry('Active architecture refactor thread')
        const follower1 = await seedEntry('Follow-up fix 1')
        const follower2 = await seedEntry('Follow-up fix 2')
        db.linkEntries(follower1, freshThread, 'resolved', undefined, 'test-ws')
        db.linkEntries(follower2, freshThread, 'implements', undefined, 'test-ws')

        const res = await readResource(
            'memory://briefing/test-ws',
            db,
            undefined,
            undefined,
            undefined,
            teamDb,
            briefingConfig,
            runtime
        )
        const md = String(res.data)
        const activeLine = md.split('\n').find((l) => l.includes('Active threads (14d):')) ?? ''
        expect(activeLine).toContain(
            `#${String(freshThread)} (technical_note) Active architecture refactor thread (+2)`
        )
        expect(activeLine).not.toContain(`#${String(consolidationHub)}`)
    })

    it('resolves mixed-preset tool hints accurately and suppresses write footers in readonly mode', async () => {
        const starterFilter = {
            raw: 'starter',
            rules: [],
            enabledTools: new Set(['create_entry', 'get_entry_by_id', 'mj_execute_code']),
        }
        expect(resolveToolHintName(starterFilter, 'get_entry_by_id', 'mj.core.getEntryById')).toBe(
            'get_entry_by_id'
        )
        expect(
            resolveToolHintName(
                starterFilter,
                'visualize_relationships',
                'mj.relationships.visualizeRelationships({ entry_id, depth: 2 })'
            )
        ).toBe('mj.relationships.visualizeRelationships({ entry_id, depth: 2 })')

        const readonlyFilter = {
            raw: 'readonly',
            rules: [],
            enabledTools: new Set(['get_entry_by_id', 'visualize_relationships']),
        }
        await seedEntry('Orphan note for readonly graph')
        const graphRes = await readResource(
            'memory://graph/test-ws',
            db,
            undefined,
            readonlyFilter,
            undefined,
            teamDb,
            briefingConfig,
            runtime
        )
        const graphMd = String(graphRes.data)
        expect(graphMd).not.toContain('Link: `')
        expect(graphMd).toContain('Expand: `visualize_relationships`')
    })

    it('enforces agent-context parity (#N, ?pin_session=false, valid YAML, degrees, wildcard InvalidParams) and unresolved briefing list_projects hint', async () => {
        const e1 = await seedEntry('YAML: tricky #value "quoted" entry', { session_id: 'sess-yaml' })
        const e2 = await seedEntry('Linked peer entry', { session_id: 'sess-yaml' })
        db.linkEntries(e1, e2, 'references', undefined, 'test-ws')

        // Wildcard rejected with ProtocolError(InvalidParams) across briefing, graph, and agent-context
        await expect(
            readResource('memory://briefing/*', db, undefined, undefined, undefined, teamDb, briefingConfig, runtime)
        ).rejects.toThrow(ProtocolError)
        await expect(
            readResource('memory://graph/*', db, undefined, undefined, undefined, teamDb, briefingConfig, runtime)
        ).rejects.toThrow(ProtocolError)
        await expect(
            readResource('memory://agent-context/*', db, undefined, undefined, undefined, teamDb, briefingConfig, runtime)
        ).rejects.toThrow(ProtocolError)

        // Numeric #5 lookup + ?pin_session=false + ?session_id= produces parseable YAML with degrees
        const ctxRes = await readResource(
            'memory://agent-context/%235?session_id=sess-yaml&pin_session=false',
            db,
            undefined,
            undefined,
            undefined,
            teamDb,
            briefingConfig,
            runtime
        )
        const ctxYaml = String(ctxRes.data)
        expect(ctxYaml).toContain('↔1')
        const parsed = parseYaml(ctxYaml) as Record<string, unknown>
        expect(parsed['Workspace ID']).toBe('test-ws')
        expect(parsed['Project Number']).toBe(5)

        // Unresolved repo in briefing surfaces list_projects guidance
        const unresolved = await readResource(
            'memory://briefing/unknown-repo-xyz',
            db,
            undefined,
            undefined,
            undefined,
            teamDb,
            briefingConfig,
            runtime
        )
        expect(String(unresolved.data)).toContain('list_projects')
    })

    it('ignores query-like substrings inside #fragments and quotes @-prefixed YAML workspaces', async () => {
        // Fragment-before-query should NOT be treated as ?days=90 on memory://graph
        const graphFrag = await readResource(
            'memory://graph/test-ws#section?days=90',
            db,
            undefined,
            undefined,
            undefined,
            teamDb,
            briefingConfig,
            runtime
        )
        expect(String(graphFrag.data)).toContain('last 14d')

        // Fragment-before-query should NOT be treated as ?session_id= on memory://agent-context
        const ctxFrag = await readResource(
            'memory://agent-context/test-ws#frag?session_id=sess-ignored',
            db,
            undefined,
            undefined,
            undefined,
            teamDb,
            briefingConfig,
            runtime
        )
        expect(String(ctxFrag.data)).not.toContain('Session Entries:')

        // Scoped @org/pkg workspace must produce valid parseable YAML
        const scopedConfig: BriefingConfig = {
            ...briefingConfig,
            projectRegistry: {
                '@org/pkg': { path: '/tmp/org-pkg', project_number: 42 },
            },
        }
        const scopedCtx = await readResource(
            'memory://agent-context/@org/pkg?pin_session=false',
            db,
            undefined,
            undefined,
            undefined,
            teamDb,
            scopedConfig,
            runtime
        )
        const parsedScoped = parseYaml(String(scopedCtx.data)) as Record<string, unknown>
        expect(parsedScoped['Project']).toBe('@org/pkg')
        expect(parsedScoped['Workspace ID']).toBe('@org/pkg')
        expect(parsedScoped['Project Number']).toBe(42)
    })

    it('resolves exact Default registry key before lowercase default in memory://graph and quotes YAML 1.2 reserved scalars in agent-context', async () => {
        const defaultCapId = db.createEntry({
            content: 'Capital Default hub',
            workspaceId: 'Default',
            entryType: 'technical_note',
        }).id
        const defaultCapPeer = db.createEntry({
            content: 'Capital Default peer',
            workspaceId: 'Default',
            entryType: 'technical_note',
        }).id
        db.linkEntries(defaultCapId, defaultCapPeer, 'references', undefined, 'Default')

        const mixedCaseConfig: BriefingConfig = {
            ...briefingConfig,
            projectRegistry: {
                Default: { path: '/tmp/cap-default', project_number: 99 },
            },
        }
        const graphCap = await readResource(
            'memory://graph/Default',
            db,
            undefined,
            undefined,
            undefined,
            teamDb,
            mixedCaseConfig,
            runtime
        )
        expect(String(graphCap.data)).toContain('# Graph neighborhood · Default')
        expect(String(graphCap.data)).toContain(`#${String(defaultCapId)} -references-> #${String(defaultCapPeer)}`)

        const capCtx = await readResource(
            'memory://agent-context/Default',
            db,
            undefined,
            undefined,
            undefined,
            teamDb,
            mixedCaseConfig,
            runtime
        )
        const parsedCapCtx = parseYaml(String(capCtx.data)) as Record<string, unknown>
        expect(parsedCapCtx['Project']).toBe('Default')
        expect(parsedCapCtx['Workspace ID']).toBe('Default')
        expect(parsedCapCtx['Project Number']).toBe(99)
        expect(getActiveSessionProject(runtime)).toEqual({ workspaceId: 'Default', projectNumber: 99 })

        const lowerDefaultRuntime = new ServerRuntime()
        const lowerDefaultConfig: BriefingConfig = {
            ...briefingConfig,
            projectRegistry: {
                default: { path: '/tmp/lower-default', project_number: 5 },
            },
        }
        const lowerCtx = await readResource(
            'memory://agent-context/%235',
            db,
            undefined,
            undefined,
            undefined,
            teamDb,
            lowerDefaultConfig,
            lowerDefaultRuntime
        )
        const parsedLowerCtx = parseYaml(String(lowerCtx.data)) as Record<string, unknown>
        expect(parsedLowerCtx['Workspace ID']).toBe('default')
        expect(parsedLowerCtx['Project Number']).toBe(5)
        expect(getActiveSessionProject(lowerDefaultRuntime)).toEqual({
            workspaceId: 'default',
            projectNumber: 5,
        })

        for (const scalarRepo of ['true', 'null', '123', '---', '-dash', '0x1f', 'my.repo']) {
            const ctxOut = await readResource(
                `memory://agent-context/${encodeURIComponent(scalarRepo)}?pin_session=false`,
                db,
                undefined,
                undefined,
                undefined,
                teamDb,
                { ...briefingConfig, projectRegistry: {} },
                runtime
            )
            const parsed = parseYaml(String(ctxOut.data)) as Record<string, unknown>
            expect(parsed['Project']).toBe(scalarRepo)
            expect(parsed['Workspace ID']).toBe(scalarRepo)
        }
    })
})
