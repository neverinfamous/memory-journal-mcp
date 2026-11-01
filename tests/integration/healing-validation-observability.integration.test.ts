import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { McpServer } from '@modelcontextprotocol/server'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditLogger } from '../../src/audit/audit-logger.js'
import { createAuditInterceptor } from '../../src/audit/interceptor.js'
import { DatabaseAdapterFactory } from '../../src/database/adapter-factory.js'
import { getGitHubIntegration } from '../../src/github/github-integration/index.js'
import { getPrompts } from '../../src/handlers/prompts/index.js'
import { getResources } from '../../src/handlers/resources/index.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { getSandboxPool } from '../../src/handlers/tools/codemode/singleton-state.js'
import { callTool, getTools } from '../../src/handlers/tools/index.js'
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

function parseToolResponsePayload(res: unknown): Record<string, unknown> {
    const structured = getProp(res, 'structuredContent')
    if (isRecord(structured)) return structured
    const content = getProp(res, 'content')
    if (Array.isArray(content) && content.length > 0) {
        const text = getProp(content[0], 'text')
        if (typeof text === 'string') {
            const parsed: unknown = JSON.parse(text)
            if (isRecord(parsed)) return parsed
        }
    }
    return {}
}

describe('Cross-Subsystem Integration: Autonomous Healing, Validation & Observability', () => {
    let tempDir: string
    let auditLogPath: string
    let db: IDatabaseAdapter
    let runtime: ServerRuntime
    let auditLogger: AuditLogger
    let configManager: ConfigManager
    let vectorManager: VectorSearchManager
    let server: McpServer

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mj-healing-obs-'))
        auditLogPath = path.join(tempDir, 'audit.jsonl')

        db = await DatabaseAdapterFactory.create(':memory:')
        await db.initialize()

        runtime = new ServerRuntime()
        auditLogger = new AuditLogger({
            enabled: true,
            logPath: auditLogPath,
            redact: false,
            auditReads: true,
            maxSizeBytes: 1024 * 1024,
        })
        runtime.auditLogger = auditLogger
        runtime.auditInterceptor = createAuditInterceptor(auditLogger)

        configManager = new ConfigManager({
            rawToolFilter: undefined,
            toolFilterConfig: null,
            briefingConfig: { ...DEFAULT_BRIEFING_CONFIG },
        })
        runtime.configManager = configManager

        vectorManager = new VectorSearchManager(db)
        const github = getGitHubIntegration('.', runtime)
        const projectRegistry = { 'healed-proj': { path: tempDir, project_number: 77 } }

        const options: ServerOptions = {
            transport: 'stdio',
            dbPath: ':memory:',
            defaultProjectNumber: 77,
            defaultWorkspaceId: 'healed-proj',
            projectRegistry,
            agentHealing: true,
        }

        const baseConfig: ToolHandlerConfig = {
            defaultProjectNumber: 77,
            defaultWorkspaceId: 'healed-proj',
            projectRegistry,
            allowedIoRoots: [tempDir],
            filterConfig: null,
            codemodeEnabled: true,
            agentHealing: true,
            runtime,
            subscriptionManager: globalSubscriptionManager,
        }

        const dispatch = (name: string, args: Record<string, unknown>): Promise<unknown> =>
            callTool(name, args, db, vectorManager, github, baseConfig)

        const customToolHandlerConfig: ToolHandlerConfig = { ...baseConfig, dispatch }
        const allTools = getTools(db, null, vectorManager, github, customToolHandlerConfig)
        const allToolNames = new Set(allTools.map((t) => t.name))
        const resources = getResources() as ResourceDefinition[]
        const prompts = getPrompts() as PromptDefinition[]

        const context: ServerContext = {
            db,
            runtime,
            vectorManager,
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
        await auditLogger.close()
        db.close()
        await fs.rm(tempDir, { recursive: true, force: true })
    })

    afterAll(() => {
        getSandboxPool().dispose()
    })

    it('normalizes camelCase nested args, resolves string project_number via projectRegistry, and routes tool aliases', async () => {
        const callToolHandler = getRequestHandler(server, 'tools/call')

        const camelRes = await callToolHandler(
            {
                method: 'tools/call',
                params: {
                    name: 'create_entry',
                    arguments: {
                        content: '## CamelCase Healing\nNormalized via call-interceptor.',
                        entryType: 'technical_note',
                        projectNumber: 'healed-proj',
                        workspaceId: 'healed-proj',
                        impactScore: 0.7,
                        trustScore: 0.9,
                        validationStatus: 'passed',
                    },
                },
            },
            {}
        )
        const camelPayload = parseToolResponsePayload(camelRes)
        expect(getProp(camelPayload, 'success')).toBe(true)
        const createdEntry = getProp(camelPayload, 'entry')
        expect(getProp(createdEntry, 'projectNumber')).toBe(77)
        expect(getProp(createdEntry, 'entryType')).toBe('technical_note')
        expect(getProp(createdEntry, 'impactScore')).toBe(0.7)

        const minimalRes = await callToolHandler(
            {
                method: 'tools/call',
                params: {
                    name: 'create_entry_minimal',
                    arguments: {
                        content: 'Minimal alias reflection entry',
                        workspace_id: 'healed-proj',
                        project_number: 77,
                    },
                },
            },
            {}
        )
        const minimalPayload = parseToolResponsePayload(minimalRes)
        expect(getProp(minimalPayload, 'success')).toBe(true)
        expect(getProp(getProp(minimalPayload, 'entry'), 'entryType')).toBe('personal_reflection')

        const execAliasRes = await callToolHandler(
            {
                method: 'tools/call',
                params: {
                    name: 'execute_code',
                    arguments: {
                        code: `return await mj.core.getRecentEntries({ workspace_id: 'healed-proj', limit: 5 });`,
                        workspace_id: 'healed-proj',
                        project_number: 77,
                    },
                },
            },
            {}
        )
        const execPayload = parseToolResponsePayload(execAliasRes)
        expect(getProp(execPayload, 'success')).toBe(true)
        const entries = getProp(getProp(execPayload, 'result'), 'entries')
        expect(Array.isArray(entries) ? entries.length : 0).toBe(2)

        const projAliasRes = await callToolHandler(
            {
                method: 'tools/call',
                params: { name: 'mj_list_projects', arguments: {} },
            },
            {}
        )
        expect(getProp(parseToolResponsePayload(projAliasRes), 'success')).toBe(true)
    })

    it('autonomously heals MCP prompts and resources when invoked via tools/call', async () => {
        const callToolHandler = getRequestHandler(server, 'tools/call')

        db.createEntry({
            content: 'Seeded entry for protocol healing check',
            entryType: 'technical_note',
            workspaceId: 'healed-proj',
            projectNumber: 77,
        })

        const promptToolRes = await callToolHandler(
            {
                method: 'tools/call',
                params: { name: 'load-briefing', arguments: {} },
            },
            {}
        )
        const promptPayload = parseToolResponsePayload(promptToolRes)
        expect(getProp(promptPayload, 'success')).toBe(true)
        expect(Array.isArray(getProp(promptPayload, 'messages'))).toBe(true)
        expect(String(getProp(promptPayload, '_healing_note'))).toContain('AUTONOMOUS HEALING')

        const resourceToolRes = await callToolHandler(
            {
                method: 'tools/call',
                params: { name: 'read_resource', arguments: { uri: 'memory://health' } },
            },
            {}
        )
        const resourcePayload = parseToolResponsePayload(resourceToolRes)
        expect(getProp(resourcePayload, 'success')).toBe(true)
        expect(isRecord(getProp(resourcePayload, 'data'))).toBe(true)
        expect(String(getProp(resourcePayload, '_healing_note'))).toContain('AUTONOMOUS HEALING')
        expect(String(getProp(resourcePayload, '_healing_note'))).toContain('memory://health')
    })

    it('recovers raw SQL and raw JSON payloads passed into mj_execute_code against the real SQLite DB', async () => {
        const callToolHandler = getRequestHandler(server, 'tools/call')

        const rawJsonCode = JSON.stringify({
            title: 'JSON Recovery Entry',
            content: 'Created from raw JSON passed to mj_execute_code',
            entry_type: 'technical_note',
            tags: ['healed-json'],
            workspace_id: 'healed-proj',
            project_number: 77,
        })

        const jsonRecoveryRes = await callToolHandler(
            {
                method: 'tools/call',
                params: {
                    name: 'mj_execute_code',
                    arguments: {
                        code: rawJsonCode,
                        workspace_id: 'healed-proj',
                        project_number: 77,
                    },
                },
            },
            {}
        )
        const jsonPayload = parseToolResponsePayload(jsonRecoveryRes)
        expect(getProp(jsonPayload, 'success')).toBe(true)
        const createdFromJson = getProp(getProp(jsonPayload, 'result'), 'entry')
        expect(getProp(createdFromJson, 'id')).toBe(1)
        expect(String(getProp(createdFromJson, 'content'))).toContain('JSON Recovery Entry')

        const sqlRecoveryRes = await callToolHandler(
            {
                method: 'tools/call',
                params: {
                    name: 'mj_execute_code',
                    arguments: {
                        code: 'SELECT * FROM memory_journal LIMIT 5',
                        workspace_id: 'healed-proj',
                        project_number: 77,
                    },
                },
            },
            {}
        )
        const sqlPayload = parseToolResponsePayload(sqlRecoveryRes)
        expect(getProp(sqlPayload, 'success')).toBe(true)
        const sqlEntries = getProp(getProp(sqlPayload, 'result'), 'entries')
        expect(Array.isArray(sqlEntries) ? sqlEntries.length : 0).toBe(1)
    })

    it('returns structured VALIDATION_ERROR payloads for unhealable Zod errors and records error telemetry', async () => {
        const callToolHandler = getRequestHandler(server, 'tools/call')
        const errorsBefore = runtime.metrics.getSummary().totalErrors

        const invalidCreateRes = await callToolHandler(
            {
                method: 'tools/call',
                params: {
                    name: 'create_entry',
                    arguments: {
                        content: '',
                        entry_type: 'technical_note',
                        workspace_id: 'healed-proj',
                        project_number: 77,
                    },
                },
            },
            {}
        )
        const invalidCreatePayload = parseToolResponsePayload(invalidCreateRes)
        expect(getProp(invalidCreatePayload, 'success')).toBe(false)
        expect(getProp(invalidCreatePayload, 'code')).toBe('VALIDATION_ERROR')
        expect(getProp(invalidCreatePayload, 'category')).toBe('validation')
        expect(typeof getProp(invalidCreatePayload, 'suggestion')).toBe('string')

        const diagZodRes = await callToolHandler(
            {
                method: 'tools/call',
                params: { name: 'test_error_handling', arguments: { error_type: 'zod' } },
            },
            {}
        )
        const diagPayload = parseToolResponsePayload(diagZodRes)
        expect(getProp(diagPayload, 'success')).toBe(false)
        expect(getProp(diagPayload, 'code')).toBe('VALIDATION_ERROR')
        expect(getProp(diagPayload, 'category')).toBe('validation')

        const summaryAfter = runtime.metrics.getSummary()
        expect(summaryAfter.totalErrors).toBeGreaterThanOrEqual(errorsBefore + 2)
        expect(getProp(getProp(summaryAfter.toolBreakdown, 'create_entry'), 'errorCount')).toBe(1)
        expect(
            getProp(getProp(summaryAfter.toolBreakdown, 'test_error_handling'), 'errorCount')
        ).toBe(1)

        const auditSearch = await auditLogger.search({ limit: 10 })
        const auditedToolNames = auditSearch.map((e) => e.tool)
        expect(auditedToolNames).toContain('create_entry')
        expect(auditedToolNames).toContain('test_error_handling')
    })

    it('preserves maintenance entry_type, normalizes resolves relationship alias, persists anchors, and computes relationshipBreakdown & density', async () => {
        const callToolHandler = getRequestHandler(server, 'tools/call')

        const firstRes = await callToolHandler(
            {
                method: 'tools/call',
                params: {
                    name: 'create_entry',
                    arguments: {
                        content: '## Initial Blocker\nInvestigating anchor persistence.',
                        entry_type: 'bug_fix',
                        workspace_id: 'healed-proj',
                        project_number: 77,
                        anchors: [{ anchor_path: 'src/handlers/tools/core/tools.ts', anchor_type: 'file' }],
                    },
                },
            },
            {}
        )
        const firstPayload = parseToolResponsePayload(firstRes)
        expect(getProp(firstPayload, 'success')).toBe(true)
        const firstId = Number(getProp(firstPayload, 'id'))
        expect(db.getAnchorsByEntryId(firstId).length).toBe(1)
        expect(db.getAnchorsByEntryId(firstId)[0]?.anchorPath).toBe('src/handlers/tools/core/tools.ts')

        const secondRes = await callToolHandler(
            {
                method: 'tools/call',
                params: {
                    name: 'create_entry',
                    arguments: {
                        content: '## CMS-02 Maintenance Pass\nResolved anchor persistence and consolidated graph.',
                        entry_type: 'maintenance',
                        significance_type: 'milestone',
                        workspace_id: 'healed-proj',
                        project_number: 77,
                        relationships: [{ targetId: firstId, relationType: 'resolves' }],
                    },
                },
            },
            {}
        )
        const secondPayload = parseToolResponsePayload(secondRes)
        expect(getProp(secondPayload, 'success')).toBe(true)
        const secondEntry = getProp(secondPayload, 'entry')
        expect(getProp(secondEntry, 'entryType')).toBe('maintenance')

        const secondId = Number(getProp(secondPayload, 'id'))
        const rels = db.getRelationships(secondId)
        expect(rels.some((r) => r.toEntryId === firstId && r.relationshipType === 'resolved')).toBe(true)

        const linkRes = await callToolHandler(
            {
                method: 'tools/call',
                params: {
                    name: 'link_entries',
                    arguments: {
                        from_entry_id: secondId,
                        to_entry_id: firstId,
                        relationship_type: 'relates_to',
                        workspace_id: 'healed-proj',
                    },
                },
            },
            {}
        )
        const linkPayload = parseToolResponsePayload(linkRes)
        expect(getProp(linkPayload, 'success')).toBe(true)
        expect(getProp(getProp(linkPayload, 'relationship'), 'relationshipType')).toBe('references')

        const statsRes = await callToolHandler(
            {
                method: 'tools/call',
                params: {
                    name: 'get_statistics',
                    arguments: { workspace_id: '*' },
                },
            },
            {}
        )
        const statsPayload = parseToolResponsePayload(statsRes)
        expect(getProp(statsPayload, 'success')).toBe(true)
        const rc = getProp(statsPayload, 'relationshipComplexity')
        expect(getProp(rc, 'density')).toBe(1)
        const breakdown = getProp(statsPayload, 'relationshipBreakdown')
        expect(getProp(breakdown, 'resolved')).toBe(1)
        expect(getProp(breakdown, 'references')).toBe(1)
    })
})
