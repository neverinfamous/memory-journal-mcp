import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { McpServer } from '@modelcontextprotocol/server'
import BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { deterministicEmbedder } = vi.hoisted(() => {
    const embed = (): Promise<{ data: Float32Array }> =>
        Promise.resolve({ data: new Float32Array(16).fill(0.25) })
    return { deterministicEmbedder: embed }
})

vi.mock('@huggingface/transformers', () => ({
    pipeline: vi.fn().mockResolvedValue(deterministicEmbedder),
    env: { allowRemoteModels: false, localModelPath: '' },
}))

import { DatabaseAdapterFactory } from '../../src/database/adapter-factory.js'
import { getGitHubIntegration } from '../../src/github/github-integration/index.js'
import { getPrompts } from '../../src/handlers/prompts/index.js'
import { getResources } from '../../src/handlers/resources/index.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { callTool, getTools } from '../../src/handlers/tools/index.js'
import { runAutoPrune } from '../../src/server/auto-prune.js'
import { createServerInstance } from '../../src/server/mcp-server/tool-registration.js'
import type { ServerContext, ServerOptions } from '../../src/server/mcp-server/types.js'
import type { PromptDefinition, ResourceDefinition } from '../../src/server/registration.js'
import { globalSubscriptionManager } from '../../src/server/subscription-manager.js'
import type { IDatabaseAdapter, ToolHandlerConfig } from '../../src/types/index.js'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'

type RequestHandlerFn = (req: unknown, extra: unknown) => Promise<unknown>

function isRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function getProp(obj: unknown, key: string): unknown {
    if (!isRecord(obj)) return undefined
    const found = Object.entries(obj).find(([k]) => k === key)
    return found ? found[1] : undefined
}

function getRequestHandler(server: McpServer, method: string): RequestHandlerFn {
    const internalServer: unknown = server.server
    const handlers = getProp(internalServer, '_requestHandlers')
    if (handlers instanceof Map) {
        const handler = handlers.get(method) as RequestHandlerFn | undefined
        if (handler !== undefined) {
            return (req: unknown, extra: unknown) => {
                const sessionId =
                    isRecord(extra) && typeof getProp(extra, 'sessionId') === 'string'
                        ? String(getProp(extra, 'sessionId'))
                        : undefined
                return handler(req, {
                    ...(sessionId !== undefined ? { sessionId } : {}),
                    mcpReq: { requestState: () => undefined },
                })
            }
        }
    }
    throw new Error(`Request handler not found for method: ${method}`)
}

describe('Cross-Subsystem Integration: MCP Protocol, Subscriptions & Data Lifecycle', () => {
    let tempDir: string
    let dbPath: string
    let teamDbPath: string
    let db: IDatabaseAdapter
    let teamDb: IDatabaseAdapter
    let runtime: ServerRuntime
    let configManager: ConfigManager
    let vectorManager: VectorSearchManager
    let teamVectorManager: VectorSearchManager
    let server: McpServer

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mj-protocol-lifecycle-'))
        dbPath = path.join(tempDir, 'journal.db')
        teamDbPath = path.join(tempDir, 'team.db')

        db = await DatabaseAdapterFactory.create(dbPath)
        await db.initialize()

        teamDb = await DatabaseAdapterFactory.create(teamDbPath)
        await teamDb.initialize()
        teamDb.applyTeamSchema()

        runtime = new ServerRuntime()
        configManager = new ConfigManager({
            rawToolFilter: undefined,
            toolFilterConfig: null,
            briefingConfig: { ...DEFAULT_BRIEFING_CONFIG },
        })
        runtime.configManager = configManager

        vectorManager = new VectorSearchManager(db)
        teamVectorManager = new VectorSearchManager(teamDb)
        const github = getGitHubIntegration('.', runtime)

        const options: ServerOptions = {
            transport: 'stdio',
            dbPath,
            teamDbPath,
            defaultProjectNumber: 55,
            defaultWorkspaceId: 'lifecycle-ws',
            projectRegistry: { 'lifecycle-ws': { path: tempDir, project_number: 55 } },
        }

        const baseConfig: ToolHandlerConfig = {
            defaultProjectNumber: 55,
            defaultWorkspaceId: 'lifecycle-ws',
            projectRegistry: options.projectRegistry,
            allowedIoRoots: [tempDir],
            filterConfig: null,
            codemodeEnabled: true,
            runtime,
            subscriptionManager: globalSubscriptionManager,
        }

        const dispatch = (name: string, args: Record<string, unknown>): Promise<unknown> =>
            callTool(name, args, db, vectorManager, github, baseConfig, undefined, teamDb, teamVectorManager)

        const customToolHandlerConfig: ToolHandlerConfig = { ...baseConfig, dispatch }
        const allTools = getTools(db, null, vectorManager, github, customToolHandlerConfig, teamDb, teamVectorManager)
        const allToolNames = new Set(allTools.map((t) => t.name))
        const resources = getResources() as ResourceDefinition[]
        const prompts = getPrompts() as PromptDefinition[]

        configManager.on('changed', () => {
            void globalSubscriptionManager.notifyResourceUpdated('memory://briefing')
            void globalSubscriptionManager.broadcastNotification('notifications/tools/list_changed')
            void globalSubscriptionManager.broadcastNotification('notifications/resources/list_changed')
        })

        const context: ServerContext = {
            db,
            teamDb,
            runtime,
            vectorManager,
            teamVectorManager,
            github,
            configManager,
            scheduler: null,
            allowedIoRoots: [tempDir],
        }

        server = createServerInstance(
            context,
            options,
            prompts,
            resources,
            allTools,
            allToolNames,
            customToolHandlerConfig
        )
    })

    afterEach(async () => {
        globalSubscriptionManager.unregisterServer('test-session')
        globalSubscriptionManager.unregisterServer('stdio')
        db.close()
        teamDb.close()
        await fs.rm(tempDir, { recursive: true, force: true })
    })

    it('routes resources/subscribe and dispatches resource update notifications on personal and team mutations', async () => {
        const sendResourceUpdatedSpy = vi
            .spyOn(server.server, 'sendResourceUpdated')
            .mockResolvedValue(undefined)

        const subscribeHandler = getRequestHandler(server, 'resources/subscribe')
        const unsubscribeHandler = getRequestHandler(server, 'resources/unsubscribe')
        const callToolHandler = getRequestHandler(server, 'tools/call')

        for (const uri of ['memory://briefing', 'memory://recent', 'memory://team/recent']) {
            await subscribeHandler(
                { method: 'resources/subscribe', params: { uri } },
                { sessionId: 'test-session' }
            )
        }

        const createRes = await callToolHandler(
            {
                method: 'tools/call',
                params: {
                    name: 'create_entry',
                    arguments: {
                        content: 'Personal mutation triggering resource notification',
                        entry_type: 'technical_note',
                        workspace_id: 'lifecycle-ws',
                        project_number: 55,
                    },
                },
            },
            { sessionId: 'test-session' }
        )
        expect(getProp(getProp(createRes, 'structuredContent'), 'success')).toBe(true)

        const notifiedAfterPersonal = sendResourceUpdatedSpy.mock.calls.map((c) => c[0].uri)
        expect(notifiedAfterPersonal).toContain('memory://briefing')
        expect(notifiedAfterPersonal).toContain('memory://recent')
        expect(notifiedAfterPersonal).not.toContain('memory://team/recent')

        sendResourceUpdatedSpy.mockClear()

        const teamCreateRes = await callToolHandler(
            {
                method: 'tools/call',
                params: {
                    name: 'team_create_entry',
                    arguments: {
                        content: 'Team mutation triggering team/recent notification',
                        entry_type: 'technical_note',
                        workspace_id: 'lifecycle-ws',
                        project_number: 55,
                    },
                },
            },
            { sessionId: 'test-session' }
        )
        expect(getProp(getProp(teamCreateRes, 'structuredContent'), 'success')).toBe(true)

        const notifiedAfterTeam = sendResourceUpdatedSpy.mock.calls.map((c) => c[0].uri)
        expect(notifiedAfterTeam).toContain('memory://briefing')
        expect(notifiedAfterTeam).toContain('memory://recent')
        expect(notifiedAfterTeam).toContain('memory://team/recent')

        sendResourceUpdatedSpy.mockClear()
        await unsubscribeHandler(
            { method: 'resources/unsubscribe', params: { uri: 'memory://recent' } },
            { sessionId: 'test-session' }
        )

        await callToolHandler(
            {
                method: 'tools/call',
                params: {
                    name: 'create_entry',
                    arguments: {
                        content: 'Second personal mutation after unsubscribe',
                        entry_type: 'technical_note',
                        workspace_id: 'lifecycle-ws',
                        project_number: 55,
                    },
                },
            },
            { sessionId: 'test-session' }
        )

        const notifiedAfterUnsub = sendResourceUpdatedSpy.mock.calls.map((c) => c[0].uri)
        expect(notifiedAfterUnsub).toContain('memory://briefing')
        expect(notifiedAfterUnsub).not.toContain('memory://recent')
    })

    it('dynamically updates active tool filter via update_configuration and reflects in tools/list', async () => {
        const notificationSpy = vi.spyOn(server.server, 'notification').mockResolvedValue(undefined)
        vi.spyOn(server.server, 'sendResourceUpdated').mockResolvedValue(undefined)

        const subscribeHandler = getRequestHandler(server, 'resources/subscribe')
        const listToolsHandler = getRequestHandler(server, 'tools/list')
        const callToolHandler = getRequestHandler(server, 'tools/call')

        await subscribeHandler(
            { method: 'resources/subscribe', params: { uri: 'memory://briefing' } },
            { sessionId: 'test-session' }
        )

        const initialList = await listToolsHandler({ method: 'tools/list', params: {} }, {})
        const initialTools = getProp(initialList, 'tools')
        const initialCount = Array.isArray(initialTools) ? initialTools.length : 0
        expect(initialCount).toBeGreaterThan(20)

        const updateRes = await callToolHandler(
            {
                method: 'tools/call',
                params: {
                    name: 'update_configuration',
                    arguments: { tool_filter: 'codemode', briefing_entries: 8 },
                },
            },
            { sessionId: 'test-session' }
        )
        expect(getProp(getProp(updateRes, 'structuredContent'), 'success')).toBe(true)
        expect(configManager.getConfig().rawToolFilter).toBe('codemode')
        expect(configManager.getConfig().briefingConfig.entryCount).toBe(8)

        const broadcastMethods = notificationSpy.mock.calls.map((c) => c[0].method)
        expect(broadcastMethods).toContain('notifications/tools/list_changed')

        const filteredList = await listToolsHandler({ method: 'tools/list', params: {} }, {})
        const filteredTools = getProp(filteredList, 'tools')
        const filteredNames = Array.isArray(filteredTools)
            ? filteredTools.map((t) => String(getProp(t, 'name')))
            : []
        expect(filteredNames).toContain('mj_execute_code')
        expect(filteredNames).toContain('update_configuration')
        expect(filteredNames).not.toContain('merge_tags')
        expect(filteredNames.length).toBeLessThan(initialCount)
    })

    it('coordinates runAutoPrune (backup, archive, soft-delete, hard-delete, vector sync) and restore_backup recovery', async () => {
        db.createVecTable(4)
        const daysAgoIso = (days: number): string =>
            new Date(Date.now() - days * 86_400_000).toISOString()

        const recentEntry = db.createEntry({
            content: 'Recent high-value entry',
            entryType: 'technical_note',
            timestamp: daysAgoIso(2),
            workspaceId: 'lifecycle-ws',
            projectNumber: 55,
        })
        db.upsertVector(recentEntry.id, new Float32Array([0.1, 0.2, 0.3, 0.4]))

        const archiveCandidate = db.createEntry({
            content: 'Twenty day old entry to archive',
            entryType: 'personal_reflection',
            timestamp: daysAgoIso(20),
            workspaceId: 'lifecycle-ws',
            projectNumber: 55,
        })
        db.upsertVector(archiveCandidate.id, new Float32Array([0.2, 0.3, 0.4, 0.5]))

        const pruneCandidate = db.createEntry({
            content: 'Forty-five day old entry to soft-delete',
            entryType: 'personal_reflection',
            timestamp: daysAgoIso(45),
            workspaceId: 'lifecycle-ws',
            projectNumber: 55,
        })
        db.upsertVector(pruneCandidate.id, new Float32Array([0.3, 0.4, 0.5, 0.6]))

        const hardDeleteCandidate = db.createEntry({
            content: 'Old soft-deleted entry to hard-delete',
            entryType: 'personal_reflection',
            timestamp: daysAgoIso(100),
            workspaceId: 'lifecycle-ws',
            projectNumber: 55,
        })
        db.deleteEntry(hardDeleteCandidate.id, false)
        db.upsertVector(hardDeleteCandidate.id, new Float32Array([0.4, 0.5, 0.6, 0.7]))

        const directDb = new BetterSqlite3(dbPath)
        directDb
            .prepare('UPDATE memory_journal SET deleted_at = ? WHERE id = ?')
            .run(daysAgoIso(90), hardDeleteCandidate.id)
        directDb.close()

        expect(db.getVectorCount()).toBe(4)
        expect(vectorManager.getStats().itemCount).toBe(4)

        const pruneResult = await runAutoPrune(db, {
            archiveOlderThanDays: 10,
            pruneOlderThanDays: 30,
            hardDeleteOlderThanDays: 60,
            importanceThreshold: 0.99,
        })

        expect(pruneResult.backupFile).not.toBeNull()
        expect(pruneResult.archivedCount).toBe(1)
        expect(pruneResult.prunedCount).toBe(1)
        expect(pruneResult.hardDeletedCount).toBe(1)
        expect(db.getVectorCount()).toBe(2)

        expect(db.getEntryById(recentEntry.id, 'lifecycle-ws')?.isArchived).toBe(false)
        expect(db.getEntryById(archiveCandidate.id, 'lifecycle-ws')?.isArchived).toBe(true)
        expect(db.getEntryById(pruneCandidate.id, 'lifecycle-ws')).toBeNull()
        expect(db.getEntryByIdIncludeDeleted(pruneCandidate.id, 'lifecycle-ws')?.deletedAt).toBeDefined()
        expect(db.getEntryByIdIncludeDeleted(hardDeleteCandidate.id, 'lifecycle-ws')).toBeNull()

        const callToolHandler = getRequestHandler(server, 'tools/call')
        const restoreRes = await callToolHandler(
            {
                method: 'tools/call',
                params: {
                    name: 'restore_backup',
                    arguments: { filename: pruneResult.backupFile, confirm: true },
                },
            },
            { sessionId: 'test-session' }
        )

        const structuredRestore = getProp(restoreRes, 'structuredContent')
        expect(getProp(structuredRestore, 'success')).toBe(true)
        expect(getProp(structuredRestore, 'previousEntryCount')).toBe(2)
        expect(getProp(structuredRestore, 'newEntryCount')).toBe(3)

        expect(db.getEntryById(pruneCandidate.id, 'lifecycle-ws')).not.toBeNull()
        expect(db.getEntryById(archiveCandidate.id, 'lifecycle-ws')?.isArchived).toBe(false)
        expect(db.getEntryByIdIncludeDeleted(hardDeleteCandidate.id, 'lifecycle-ws')).not.toBeNull()
    })
})
