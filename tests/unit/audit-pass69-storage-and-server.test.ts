import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { extractUriFromArgs } from '../../src/handlers/tools/core/dummy-healing/mcp-fallbacks.js'
import { normalizeAndAliasToolCall } from '../../src/server/mcp-server/tool-registration/call-arg-normalizer.js'
import { applyArgInterceptions } from '../../src/codemode/param-normalizer.js'
import { GetProjectSchemaMcp } from '../../src/handlers/tools/admin/schemas/project-and-ops-schemas.js'
import { AuditLogger } from '../../src/audit/audit-logger.js'
import { createAuditInterceptor } from '../../src/audit/interceptor.js'
import { setActiveSessionProject } from '../../src/utils/workspace-resolver.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { getMiscSearchTools } from '../../src/handlers/tools/search/misc-tools.js'
import { resolveCandidates } from '../../src/vector/vector-search-manager/candidate-search.js'
import { logger } from '../../src/utils/logger.js'
import { McpLogger } from '../../src/utils/mcp-logger.js'
import { RepositoryManager } from '../../src/github/github-integration/repository.js'
import type { GitHubClient } from '../../src/github/github-integration/client.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import type { ServerOptions, ToolContext, ToolDefinition } from '../../src/types/index.js'

const SAVED_ENV_KEYS = ['MJ_DB_ENCRYPTION_KEY', 'DB_ENCRYPTION_KEY'] as const

const TEST_REGISTRY = {
    'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
    companion: { path: process.cwd(), project_number: 16 },
}

function requireTool(tools: ToolDefinition[], name: string): ToolDefinition {
    const found = tools.find((t) => t.name === name)
    if (found === undefined) throw new Error(`Expected tool '${name}'`)
    return found
}

describe('Pass 69 Audit — URIs, Normalizers, Audit Scope, Schemas, Loggers & Prompt', () => {
    const savedEnv = new Map<string, string | undefined>()
    const tempDirs: string[] = []

    function makeTempDir(prefix: string): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
        tempDirs.push(dir)
        return dir
    }

    beforeEach(() => {
        for (const k of SAVED_ENV_KEYS) savedEnv.set(k, process.env[k])
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
    })

    afterEach(() => {
        vi.restoreAllMocks()
        for (const k of SAVED_ENV_KEYS) {
            const orig = savedEnv.get(k)
            if (orig !== undefined) process.env[k] = orig
            else delete process.env[k]
        }
        while (tempDirs.length > 0) {
            const d = tempDirs.pop()
            if (d !== undefined && fs.existsSync(d)) {
                fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
            }
        }
    })

    it('TB2-H1: extractUriFromArgs resolves all live root/alias prefixes case-insensitively with # boundaries', () => {
        expect(extractUriFromArgs({ uri: 'actions/recent' })).toBe('memory://actions/recent')
        expect(extractUriFromArgs({ uri: 'rules#security' })).toBe('memory://rules#security')
        expect(extractUriFromArgs({ uri: 'ACTIONS/recent' })).toBe('memory://actions/recent')
        expect(extractUriFromArgs({ uri: 'staleness' })).toBe('memory://staleness')
        expect(extractUriFromArgs({ uri: 'commits/1' })).toBe('memory://commits/1')
        expect(extractUriFromArgs({ uri: 'status' })).toBe('memory://status')
        expect(extractUriFromArgs({ uri: 'unregistered-repo' })).toBe(
            'memory://briefing/unregistered-repo'
        )
    })

    it('TB2-M1: project-registry admin tools skip workspace_id stamping across call-arg-normalizer and param-normalizer', () => {
        const reqParams: { name?: string; arguments?: Record<string, unknown> } = {
            name: 'get_project',
            arguments: { project: 'companion' },
        }
        normalizeAndAliasToolCall(reqParams, {
            projectRegistry: TEST_REGISTRY,
        } as unknown as ServerOptions)
        expect(reqParams.arguments?.['workspace_id']).toBeUndefined()
        expect(reqParams.arguments?.['project_number']).toBeUndefined()

        const intercepted = applyArgInterceptions('get_project', [reqParams.arguments])
        expect('error' in intercepted).toBe(false)
        if (!('error' in intercepted)) {
            const firstArg = intercepted.args[0] as Record<string, unknown>
            expect(firstArg['workspace_id']).toBeUndefined()
            const parsed = GetProjectSchemaMcp.parse(firstArg)
            expect(parsed.name).toBe('companion')
        }
    })

    it('TB2-M2: audited read_resource fallback calls resolve URI scope and honor ?project_number=0', async () => {
        const logDir = makeTempDir('mj-p69-audit-')
        const logPath = path.join(logDir, 'audit.jsonl')
        const runtime = new ServerRuntime()
        setActiveSessionProject('memory-journal-mcp', 5, runtime)

        const auditLogger = new AuditLogger({
            enabled: true,
            logPath,
            redact: false,
            auditReads: true,
            maxSizeBytes: 1_000_000,
        })
        try {
            const interceptor = createAuditInterceptor(auditLogger, runtime)
            await interceptor.around(
                'read_resource',
                { uri: 'memory://briefing/companion?project_number=0' },
                () => Promise.resolve({ success: true })
            )
            await interceptor.around(
                'read_resource',
                { uri: 'memory://team/recent?project_number=42' },
                () => Promise.resolve({ success: true })
            )

            const rows = await auditLogger.recent(10)
            const suppressed = rows.find((r) => r.workspaceId === 'companion')
            expect(suppressed).toBeDefined()
            expect(suppressed?.projectNumber).toBeUndefined()

            const teamRow = rows.find((r) => r.category === 'team' && r.tool === 'read_resource')
            expect(teamRow).toBeDefined()
            expect(teamRow?.projectNumber).toBe(42)
        } finally {
            await auditLogger.close()
        }
    })

    it('TB2-M8, TB2-L2 & TB2-L4: strict deleted pagination, zero-limit candidate search, and shared row hydration', async () => {
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const e1 = db.createEntry({ content: 'Entry A', tags: ['alpha'] })
            const tools = getMiscSearchTools({ db } as unknown as ToolContext)
            const listDeleted = requireTool(tools, 'list_deleted_entries')

            const badLimit = (await listDeleted.handler({ limit: 'abc' })) as { success?: boolean }
            expect(badLimit.success).toBe(false)

            const badOffset = (await listDeleted.handler({ offset: '0x10' })) as { success?: boolean }
            expect(badOffset.success).toBe(false)

            expect(resolveCandidates(db, [{ entryId: e1.id, score: 0.9 }], 0, 'default')).toEqual([])

            const hydrated = db.getEntriesByIds([e1.id], 'default')
            expect(hydrated.get(e1.id)?.tags).toEqual(['alpha'])
        } finally {
            db.close()
        }
    })

    it('TB2-L6, TB2-L7, TB2-L9 & AP1-AP3: sanitizes loggers/git-status errors and verifies Pass 69 prompt contract', async () => {
        const stderrLines: string[] = []
        vi.spyOn(console, 'error').mockImplementation((msg: unknown) => {
            stderrLines.push(String(msg))
        })

        logger.warning('logger-p69', {
            token: 'secret-tok',
            'bad\nkey': 'ok',
            toJSON: () => 'hijack',
        })
        const mcpLog = new McpLogger()
        mcpLog.setLevel('debug')
        mcpLog.error('mcp-p69', 'msg', {
            api_key: 'top-secret',
            toJSON: () => 'hijack-mcp',
        })

        const joined = stderrLines.join('\n')
        expect(joined).not.toContain('secret-tok')
        expect(joined).not.toContain('top-secret')
        expect(joined).not.toContain('hijack')

        const fakeClient = {
            git: {
                status: async () => {
                    throw new Error('https://alice:ghp_secretToken1234567890@github.com/org/repo.git failed')
                },
                log: async () => ({ all: [] }),
            },
        } as unknown as GitHubClient
        const repoMgr = new RepositoryManager(fakeClient)
        const gitStatus = await repoMgr.getLocalGitStatus()
        expect(gitStatus.error).toBeDefined()
        expect(gitStatus.error).not.toContain('ghp_secretToken1234567890')

        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass92')
        const promptDb = new DatabaseAdapter(':memory:')
        await promptDb.initialize()
        let cqText: string
        try {
            const res = await getCodeQualityAuditPromptDefinition().handler(
                { target: 'src', copilot: 'false' },
                promptDb
            )
            cqText = res.messages[0]?.content.text ?? ''
        } finally {
            promptDb.close()
        }
        expect(cqText).toContain('Prompt revision: 2026-11-24-audit-pass92')
        expect(cqText).toContain('project-registry admin tools')
        expect(cqText).toContain('extractAuditScopeFromUri')
        expect(cqText).toContain('entryPrev')
    })
})
