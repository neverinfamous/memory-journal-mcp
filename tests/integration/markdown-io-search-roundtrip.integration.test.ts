/**
 * Cross-Subsystem Integration Test 4: Markdown IO, Vector/Hybrid Search & Cross-Team Roundtrip
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const { deterministicEmbedder } = vi.hoisted(() => {
    const embed = (text: string): Promise<{ data: Float32Array }> => {
        const vec = new Float32Array(16)
        const lower = text.toLowerCase()
        const keywords = [
            'architecture', 'raft', 'consensus', 'vector', 'sqlite', 'quantum', 'telemetry', 'pipeline',
            'security', 'oauth', 'graph', 'markdown', 'beta', 'alpha', 'team', 'cluster',
        ]
        for (let i = 0; i < keywords.length; i++) {
            const kw = keywords[i]
            vec[i] = kw !== undefined && lower.includes(kw) ? 1.0 : 0.05
        }
        let norm = 0
        for (let i = 0; i < vec.length; i++) {
            const val = vec[i] ?? 0
            norm += val * val
        }
        norm = Math.sqrt(norm) || 1
        for (let i = 0; i < vec.length; i++) {
            vec[i] = (vec[i] ?? 0) / norm
        }
        return Promise.resolve({ data: vec })
    }
    return { deterministicEmbedder: embed }
})

vi.mock('@huggingface/transformers', () => ({
    pipeline: vi.fn().mockResolvedValue(deterministicEmbedder),
    env: { allowRemoteModels: false, localModelPath: '' },
}))

import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { resetCrossTeamCacheForTests } from '../../src/handlers/tools/search/cross-team.js'
import { resolveProjectContext } from '../../src/utils/workspace-resolver.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import type { ToolHandlerConfig, JournalEntry } from '../../src/types/index.js'

interface ToolResult {
    success?: boolean
    exported_count?: number
    files?: string[]
    created?: number
    updated?: number
    relationshipsLinked?: number
    vectorsIndexed?: number
    entries?: (JournalEntry & { importanceScore?: number; team_db?: string })[]
    count?: number
    searchMode?: string
    searched_dbs?: string[]
    degraded?: boolean
    error?: string
}

function isToolResult(val: unknown): val is ToolResult {
    return typeof val === 'object' && val !== null
}

describe('Markdown IO, Vector/Hybrid Search & Cross-Team Roundtrip Integration', () => {
    const baseDir = path.resolve(process.cwd(), '.test-output', 'integration-io-search')
    const exportAlphaDir = path.join(baseDir, 'export-alpha')
    const sourceDbPath = path.join(baseDir, 'source.db')
    const targetDbPath = path.join(baseDir, 'target.db')
    const primaryTeamDbPath = path.join(baseDir, 'team-primary.db')
    const extraTeamOnePath = path.join(baseDir, 'team-eng.db')
    const extraTeamTwoPath = path.join(baseDir, 'team-ops.db')

    let sourceDb: DatabaseAdapter
    let targetDb: DatabaseAdapter
    let primaryTeamDb: DatabaseAdapter
    let extraTeamEngDb: DatabaseAdapter
    let extraTeamOpsDb: DatabaseAdapter
    let targetVectorMgr: VectorSearchManager
    let sourceConfig: ToolHandlerConfig
    let targetConfig: ToolHandlerConfig

    beforeAll(async () => {
        await fs.rm(baseDir, { recursive: true, force: true })
        await fs.mkdir(exportAlphaDir, { recursive: true })

        sourceDb = new DatabaseAdapter(sourceDbPath)
        await sourceDb.initialize()
        targetDb = new DatabaseAdapter(targetDbPath, { defaultWorkspaceId: 'ws-alpha' })
        await targetDb.initialize()

        primaryTeamDb = new DatabaseAdapter(primaryTeamDbPath)
        await primaryTeamDb.initialize()
        primaryTeamDb.applyTeamSchema()

        extraTeamEngDb = new DatabaseAdapter(extraTeamOnePath)
        await extraTeamEngDb.initialize()
        extraTeamEngDb.applyTeamSchema()

        extraTeamOpsDb = new DatabaseAdapter(extraTeamTwoPath)
        await extraTeamOpsDb.initialize()
        extraTeamOpsDb.applyTeamSchema()

        targetVectorMgr = new VectorSearchManager(targetDb, { modelName: 'deterministic-16d' })
        await targetVectorMgr.initialize()

        const projectRegistry = {
            'ws-alpha': { path: path.join(baseDir, 'alpha-repo'), project_number: 101 },
            'ws-beta': { path: path.join(baseDir, 'beta-repo'), project_number: 202 },
        }

        sourceConfig = { allowedIoRoots: [baseDir], projectRegistry, runtime: new ServerRuntime() }
        targetConfig = {
            allowedIoRoots: [baseDir],
            projectRegistry,
            additionalTeamDbs: { eng: extraTeamOnePath, ops: extraTeamTwoPath },
            runtime: new ServerRuntime(),
        }
    })

    afterAll(async () => {
        resetCrossTeamCacheForTests()
        sourceDb.close()
        targetDb.close()
        primaryTeamDb.close()
        extraTeamEngDb.close()
        extraTeamOpsDb.close()
        await fs.rm(baseDir, { recursive: true, force: true }).catch(() => undefined)
    })

    it('resolves workspaces via projectRegistry and isolates entries across ws-alpha and ws-beta', async () => {
        const resolvedByNum = resolveProjectContext({ project_number: 101 }, sourceConfig)
        expect(resolvedByNum.workspaceId).toBe('ws-alpha')
        expect(resolvedByNum.projectNumber).toBe(101)

        const resolvedByWs = resolveProjectContext({ workspace_id: 'ws-beta' }, sourceConfig)
        expect(resolvedByWs.workspaceId).toBe('ws-beta')
        expect(resolvedByWs.projectNumber).toBe(202)

        const e1 = sourceDb.createEntry({
            content: 'Distributed raft consensus architecture and cluster leader election protocol.',
            entryType: 'technical_note',
            tags: ['architecture', 'raft', 'consensus'],
            significanceType: 'architectural',
            workspaceId: 'ws-alpha',
            projectNumber: 101,
            impactScore: 0.9,
            trustScore: 0.95,
            validationStatus: 'passed',
        })
        const e2 = sourceDb.createEntry({
            content: 'Implemented sqlite vector search indexing pipeline for raft consensus telemetry.',
            entryType: 'feature_implementation',
            tags: ['vector', 'sqlite', 'raft'],
            significanceType: 'milestone',
            workspaceId: 'ws-alpha',
            projectNumber: 101,
            impactScore: 0.85,
            trustScore: 0.9,
            validationStatus: 'passed',
        })
        const e3 = sourceDb.createEntry({
            content: 'Minor scratch note on alpha.',
            entryType: 'personal_reflection',
            tags: ['scratch'],
            workspaceId: 'ws-alpha',
            timestamp: '2020-01-01T00:00:00.000Z',
            trustScore: 0.1,
            impactScore: 0.0,
        })
        sourceDb.createEntry({
            content: 'Beta workspace quantum cryptography study.',
            entryType: 'technical_note',
            tags: ['quantum', 'beta'],
            workspaceId: 'ws-beta',
            projectNumber: 202,
            timestamp: '2020-01-01T00:00:00.000Z',
            trustScore: 0.1,
            impactScore: 0.0,
        })

        const linkRes = await callTool(
            'link_entries',
            {
                from_entry_id: e2.id,
                to_entry_id: e1.id,
                relationship_type: 'implements',
                description: 'Vector indexing implements raft telemetry storage',
                workspace_id: 'ws-alpha',
            },
            sourceDb,
            undefined,
            undefined,
            sourceConfig
        )
        expect(isToolResult(linkRes) && linkRes.success).toBe(true)
        expect(sourceDb.getOrphanCount('ws-alpha')).toBe(1)
        expect(sourceDb.getOrphanCount('ws-beta')).toBe(1)
        expect(sourceDb.getOrphanCount('*')).toBe(2)
        expect(e3.id).toBeGreaterThan(0)
    })

    it('maintains accurate tag usage_count across updateEntry tag replacements (C-5 fix)', () => {
        const entry = sourceDb.createEntry({
            content: 'Tag consistency check entry in ws-beta',
            entryType: 'technical_note',
            tags: ['tag-keep', 'tag-drop'],
            workspaceId: 'ws-beta',
        })
        expect(sourceDb.listTags().find((t) => t.name === 'tag-drop')?.usageCount).toBe(1)
        sourceDb.updateEntry(entry.id, { tags: ['tag-keep', 'tag-added'], workspaceId: 'ws-beta' })
        const tagsAfter = sourceDb.listTags()
        expect(tagsAfter.find((t) => t.name === 'tag-keep')?.usageCount).toBe(1)
        expect(tagsAfter.find((t) => t.name === 'tag-drop')?.usageCount ?? 0).toBe(0)
        expect(tagsAfter.find((t) => t.name === 'tag-added')?.usageCount).toBe(1)
    })

    it('exports ws-alpha entries to markdown files and imports into fresh DB with create/update, relationship relinking, and vector indexing', async () => {
        const exportRes = await callTool(
            'export_markdown',
            { output_dir: exportAlphaDir, workspace_id: 'ws-alpha' },
            sourceDb,
            undefined,
            undefined,
            sourceConfig
        )
        expect(isToolResult(exportRes) && exportRes.exported_count).toBe(3)

        const firstImport = await callTool(
            'import_markdown',
            { source_dir: exportAlphaDir, workspace_id: 'ws-alpha' },
            targetDb,
            targetVectorMgr,
            undefined,
            targetConfig
        )
        expect(isToolResult(firstImport)).toBe(true)
        if (!isToolResult(firstImport)) return
        expect(firstImport.created).toBe(3)
        expect(firstImport.updated).toBe(0)
        expect(firstImport.vectorsIndexed).toBe(3)
        expect(firstImport.relationshipsLinked).toBeGreaterThanOrEqual(1)
        expect(targetDb.getActiveEntryCount('ws-alpha')).toBe(3)
        expect(targetDb.getActiveEntryCount('ws-beta')).toBe(0)

        const files = await fs.readdir(exportAlphaDir)
        const file1 = files.find((f) => f.startsWith('1-'))
        if (file1 !== undefined) {
            const file1Path = path.join(exportAlphaDir, file1)
            const raw = await fs.readFile(file1Path, 'utf-8')
            await fs.writeFile(
                file1Path,
                raw.replace(
                    'Distributed raft consensus architecture',
                    'Updated distributed raft consensus architecture with quorum leases'
                ),
                'utf-8'
            )
        }

        const fm = JSON.stringify({ entry_type: 'technical_note', tags: ['pipeline', 'telemetry'] }, null, 2)
        await fs.writeFile(
            path.join(exportAlphaDir, '999-new-note.md'),
            `---\n${fm}\n---\nNew markdown note without mj_id testing telemetry pipeline.`,
            'utf-8'
        )

        const secondImport = await callTool(
            'import_markdown',
            { source_dir: exportAlphaDir, workspace_id: 'ws-alpha' },
            targetDb,
            targetVectorMgr,
            undefined,
            targetConfig
        )
        expect(isToolResult(secondImport)).toBe(true)
        if (!isToolResult(secondImport)) return
        expect(secondImport.updated).toBe(3)
        expect(secondImport.created).toBe(1)
        expect(secondImport.vectorsIndexed).toBe(4)

        const updatedEntry1 = targetDb.getEntryById(1, 'ws-alpha')
        expect(updatedEntry1?.content).toContain('quorum leases')
        expect(updatedEntry1?.tags).toContain('raft')
    })

    it('queries imported entries across search_entries modes (auto, fts, semantic, hybrid RRF) and sort_by: importance', async () => {
        const autoFts = await callTool(
            'search_entries',
            { query: 'quorum', mode: 'auto', workspace_id: 'ws-alpha' },
            targetDb,
            targetVectorMgr,
            undefined,
            targetConfig
        )
        expect(isToolResult(autoFts) && autoFts.searchMode).toBe('fts (auto)')
        expect(isToolResult(autoFts) && autoFts.entries?.[0]?.id).toBe(1)

        const defaultExportDir = path.join(baseDir, 'export-default')
        await fs.mkdir(defaultExportDir, { recursive: true })
        sourceDb.createEntry({
            content: 'Default workspace raft consensus cluster architecture guide.',
            entryType: 'technical_note',
            tags: ['raft', 'consensus', 'cluster'],
            workspaceId: 'default',
        })
        await callTool('export_markdown', { output_dir: defaultExportDir, workspace_id: 'default' }, sourceDb, undefined, undefined, sourceConfig)
        await callTool('import_markdown', { source_dir: defaultExportDir, workspace_id: 'default' }, targetDb, targetVectorMgr, undefined, targetConfig)

        const autoSemantic = await callTool(
            'search_entries',
            { query: 'how does raft consensus cluster election work?', mode: 'auto', workspace_id: 'default' },
            targetDb,
            targetVectorMgr,
            undefined,
            targetConfig
        )
        expect(isToolResult(autoSemantic) && autoSemantic.searchMode).toBe('semantic (auto)')
        expect(isToolResult(autoSemantic) && (autoSemantic.count ?? 0)).toBeGreaterThan(0)

        const autoHybrid = await callTool(
            'search_entries',
            { query: 'raft consensus vector indexing', mode: 'auto', sort_by: 'importance', workspace_id: 'ws-alpha' },
            targetDb,
            targetVectorMgr,
            undefined,
            targetConfig
        )
        expect(isToolResult(autoHybrid)).toBe(true)
        if (isToolResult(autoHybrid)) {
            expect(autoHybrid.searchMode).toBe('hybrid (auto)')
            const entries = autoHybrid.entries ?? []
            expect(entries.length).toBeGreaterThanOrEqual(2)
            expect(entries[0]?.importanceScore ?? 0).toBeGreaterThanOrEqual(entries[entries.length - 1]?.importanceScore ?? 0)
        }

        const betaSearch = await callTool(
            'search_entries',
            { query: 'raft', mode: 'fts', workspace_id: 'ws-beta' },
            targetDb,
            targetVectorMgr,
            undefined,
            targetConfig
        )
        expect(isToolResult(betaSearch) && betaSearch.count).toBe(0)
    })

    it('queries across primary and additional real SQLite team DBs via cross_team_search', async () => {
        primaryTeamDb.createEntry({
            content: 'Primary team deployment runbook for zero-downtime migration.',
            entryType: 'technical_note',
            tags: ['runbook', 'deployment'],
            author: 'alice',
            workspaceId: 'ws-alpha',
        })
        extraTeamEngDb.createEntry({
            content: 'Engineering team deployment architecture for blue-green rollout.',
            entryType: 'technical_note',
            tags: ['engineering', 'deployment'],
            author: 'bob',
            workspaceId: 'ws-alpha',
        })
        extraTeamOpsDb.createEntry({
            content: 'Operations team deployment checklist and incident rollback plan.',
            entryType: 'technical_note',
            tags: ['ops', 'deployment'],
            author: 'carol',
            workspaceId: 'ws-alpha',
        })
        extraTeamOpsDb.createEntry({
            content: 'Operations team deployment secret in ws-beta.',
            entryType: 'technical_note',
            tags: ['ops', 'deployment'],
            author: 'carol',
            workspaceId: 'ws-beta',
        })

        const crossRes = await callTool(
            'cross_team_search',
            { query: 'deployment', workspace_id: 'ws-alpha' },
            targetDb,
            targetVectorMgr,
            undefined,
            targetConfig,
            undefined,
            primaryTeamDb
        )
        expect(isToolResult(crossRes)).toBe(true)
        if (!isToolResult(crossRes)) return
        expect(crossRes.degraded).toBe(false)
        expect(crossRes.count).toBe(3)
        expect(crossRes.searched_dbs).toEqual(expect.arrayContaining(['primary', 'eng', 'ops']))
        expect((crossRes.entries ?? []).map((e) => e.team_db)).toEqual(expect.arrayContaining(['primary', 'eng', 'ops']))
    })
})
