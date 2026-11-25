import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import {
    acquireRestoreLock,
    getActiveInProcessRestoreToken,
} from '../../src/database/sqlite-adapter/restore-lock.js'
import { releaseRestoreLock } from '../../src/database/sqlite-adapter/backup-helpers.js'
import { importMarkdownEntries } from '../../src/markdown/importer.js'
import { formatHandlerError } from '../../src/utils/error-helpers.js'
import { scrubAuditArgs } from '../../src/audit/audit-arg-scrubber.js'
import { extractAuditScopeFromUri } from '../../src/audit/audit-query-helpers.js'
import { MemoryJournalMcpError } from '../../src/types/errors.js'
import { getProjectTools } from '../../src/handlers/tools/admin/project-tools.js'
import { addIssueToProject } from '../../src/handlers/tools/github/create-issue-project.js'
import { healAgentHallucinations } from '../../src/handlers/tools/schemas/hallucination-healer.js'
import { healSearchPayload } from '../../src/handlers/tools/schemas/hallucination-healer-search.js'
import { hybridSearch } from '../../src/handlers/tools/search/hybrid.js'
import { resolvePromptOrResourceAccessTargets } from '../../src/server/mcp-server/tool-registration/call-interceptor-helpers.js'
import { attachCallToolInterceptor } from '../../src/server/mcp-server/tool-registration/call-interceptor.js'
import { parseToolFilter } from '../../src/filtering/tool-filter.js'
import { getTools } from '../../src/handlers/tools/index.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { seedInitialBriefingScopeFromFile } from '../../src/utils/config-manager-helpers.js'
import { getActiveSessionProject, setActiveSessionProject } from '../../src/utils/workspace-resolver.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { enrichCommits } from '../../src/github/commit-references/enricher.js'
import type { GitHubIntegration } from '../../src/github/github-integration/index.js'
import { updateBadges } from '../../scripts/update-badges.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import type { ToolDefinition, ToolRegistration } from '../../src/types/index.js'

const SAVED_ENV_KEYS = [
    'MJ_DB_ENCRYPTION_KEY',
    'DB_ENCRYPTION_KEY',
    'MEMORY_JOURNAL_CONFIG',
    'TEAM_AUTHOR',
    'GITHUB_ACTIONS',
] as const

function requireTool(tools: ToolDefinition[], name: string): ToolDefinition {
    const found = tools.find((t) => t.name === name)
    if (found === undefined) throw new Error(`Expected tool '${name}'`)
    return found
}

describe('Pass 67 Audit — Storage, Locks, Scrubbers, Search, Interceptors, Scripts & Prompts', () => {
    const savedEnv = new Map<string, string | undefined>()
    const tempDirs: string[] = []
    let savedExitCode: number | string | undefined

    function makeTempDir(prefix: string, local = false): string {
        const base = local ? path.join(process.cwd(), '.test-output', 'vitest') : os.tmpdir()
        fs.mkdirSync(base, { recursive: true })
        const dir = fs.mkdtempSync(path.join(base, prefix))
        tempDirs.push(dir)
        return dir
    }

    beforeEach(() => {
        savedExitCode = process.exitCode
        for (const k of SAVED_ENV_KEYS) savedEnv.set(k, process.env[k])
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
        delete process.env['GITHUB_ACTIONS']
    })

    afterEach(() => {
        vi.restoreAllMocks()
        process.exitCode = savedExitCode
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

    it('B-H2, B-L7 & B-M8: guards :memory: backup listing/pruning and enforces nonce-verified restore-lock cleanup', async () => {
        const memDb = new DatabaseAdapter(':memory:')
        await memDb.initialize()
        try {
            expect(memDb.listBackups()).toEqual([])
            expect(() => memDb.deleteOldBackups(0)).toThrow(/at least 1/)
            expect(() => memDb.deleteOldBackups(1)).toThrow(/in-memory/)
        } finally {
            memDb.close()
        }

        const dir = makeTempDir('mj-p67-lock-')
        const lockDir = path.join(dir, 'restore.lock')
        const lockFile = path.join(lockDir, 'lock.json')
        const runtime = new ServerRuntime()
        acquireRestoreLock(lockDir, lockFile, runtime)
        const token = getActiveInProcessRestoreToken(lockDir)
        expect(token).toBeTruthy()
        expect(() => acquireRestoreLock(lockDir, lockFile, runtime)).toThrow(/holding the database lock/i)

        releaseRestoreLock(lockDir, lockFile, 'mismatched-nonce')
        expect(fs.existsSync(lockDir)).toBe(true)

        releaseRestoreLock(lockDir, lockFile, token)
        expect(fs.existsSync(lockDir)).toBe(false)
    })

    it('B-M9: importMarkdownEntries enforces directory containment before chunk 0', async () => {
        const dir = makeTempDir('mj-p67-imp-', true)
        const allowed = path.join(dir, 'allowed')
        const outside = path.join(dir, 'outside')
        fs.mkdirSync(allowed, { recursive: true })
        fs.mkdirSync(outside, { recursive: true })
        fs.writeFileSync(
            path.join(outside, 'entry.md'),
            '---\nentry_type: technical_note\n---\n# Outside\n',
            'utf-8'
        )
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            await expect(
                importMarkdownEntries(db, outside, { dry_run: true }, undefined, [allowed])
            ).rejects.toThrow()
        } finally {
            db.close()
        }
    })

    it('B-M1: formatHandlerError & scrubAuditArgs resolve root toJSON and omit function properties', () => {
        const recordDetails = {
            toJSON(): Record<string, unknown> {
                return { access_token: 'secret-tok', note: 'visible', helperFn: () => 1 }
            },
            leakedRaw: 'ignored-because-toJSON',
        }
        const errRes = formatHandlerError(
            new MemoryJournalMcpError('bad', 'VALIDATION_ERROR', 'validation', {
                details: recordDetails,
            })
        )
        expect(errRes.details?.['access_token']).toBe('[REDACTED]')
        expect(errRes.details?.['note']).toBe('visible')
        expect(errRes.details?.['helperFn']).toBeUndefined()
        expect(errRes.details?.['toJSON']).toBeUndefined()

        const primitiveDetails = {
            toJSON(): string {
                return 'scalar-root'
            },
        }
        const primErr = formatHandlerError(
            new MemoryJournalMcpError('bad', 'VALIDATION_ERROR', 'validation', {
                details: primitiveDetails as unknown as Record<string, unknown>,
            })
        )
        expect(primErr.details).toEqual({ value: 'scalar-root' })

        expect(scrubAuditArgs({ toJSON: () => 'audit-scalar' })).toEqual({ value: 'audit-scalar' })
    })

    it('O2, O3, O4, O5: register_project keyChange, fenced Kanban statuses, healer nested container aliases & hybrid mirror collapse', async () => {
        const dir = makeTempDir('mj-p67-core-')
        const cfgFile = path.join(dir, 'cfg.json')
        fs.writeFileSync(
            cfgFile,
            JSON.stringify({
                defaultWorkspaceId: 'myproj',
                defaultProjectNumber: 5,
                projectRegistry: { myproj: { path: dir, project_number: 5 } },
            }),
            'utf-8'
        )
        process.env['MEMORY_JOURNAL_CONFIG'] = cfgFile
        const runtime = new ServerRuntime()
        setActiveSessionProject('myproj', 5, runtime)

        const db = new DatabaseAdapter(':memory:')
        const teamDb = new DatabaseAdapter(':memory:')
        await db.initialize()
        await teamDb.initialize()
        teamDb.applyTeamSchema()
        try {
            const ctxConfig = {
                defaultWorkspaceId: 'myproj',
                defaultProjectNumber: 5,
                projectRegistry: { myproj: { path: dir, project_number: 5 } },
                runtime,
            }
            const regTool = requireTool(getProjectTools({ db, config: ctxConfig }), 'register_project')
            await regTool.handler({ name: 'myproj', absolute_path: dir, project_number: 77 })
            expect(ctxConfig.defaultProjectNumber).toBe(77)
            expect(getActiveSessionProject(runtime)).toEqual({
                workspaceId: 'myproj',
                projectNumber: 77,
            })

            const fakeGh = {
                getProjectKanban: vi.fn().mockResolvedValue({
                    projectId: 'B1',
                    title: 'Board',
                    number: 5,
                    url: '',
                    fields: [],
                    statusOptions: [{ id: 's1', name: 'Ready<script>' }],
                }),
                addProjectItem: vi.fn().mockResolvedValue({ success: true, itemId: 'item-1' }),
            } as unknown as GitHubIntegration
            const kanbanRes = await addIssueToProject(fakeGh, 'org', 'repo', 'I1', 5, 'Bad<img>')
            expect(kanbanRes.initialStatus?.set).toBe(false)
            expect(kanbanRes.initialStatus?.error).toContain('<untrusted_remote_content>')
            expect(kanbanRes.initialStatus?.error).not.toContain('<script>')
            expect(kanbanRes.initialStatus?.error).not.toContain('<img>')

            const healedCreate = healAgentHallucinations({
                entry: { entryType: 'architecture', projectId: 5, content: 'arch note' },
            }) as Record<string, unknown>
            expect(healedCreate['entry_type']).toBe('project_decision')
            expect(healedCreate['significance_type']).toBe('architecture')
            expect(healedCreate['project_number']).toBe(5)

            const healedSearch = healSearchPayload({
                filters: { query: 'alpha', tag: 'one, two' },
            }) as Record<string, unknown>
            expect(healedSearch['tags']).toEqual(['one', 'two'])

            // O5: create 20 personal entries + 20 exact team mirrors so chunk 1 (< 24) collapses below limit=20
            for (let i = 1; i <= 20; i++) {
                const body = `hybridmirror${String(i)} shared token`
                const ts = `2026-11-21T12:00:${String(i).padStart(2, '0')}Z`
                const p = db.createEntry({ content: body, workspaceId: 'default', timestamp: ts })
                teamDb.createEntry({
                    content: body,
                    workspaceId: 'default',
                    timestamp: ts,
                    author: 'alice',
                    teamOriginPersonalId: p.id,
                })
            }
            const hyb = await hybridSearch('shared token', db, undefined, {
                limit: 20,
                includeTeam: true,
                teamDb,
                workspaceId: 'default',
            })
            expect(hyb.entries.length).toBe(20)
        } finally {
            teamDb.close()
            db.close()
        }
    })

    it('O7, O8, O9, B-L4, B-L5, B-L6 & AP1..AP4: fallback access, audit URI parsing, blocked tool formatting, badges, enricher cache & Pass 67 prompts', async () => {
        const promptTargets = resolvePromptOrResourceAccessTargets(
            'get_prompt',
            { name: '   ', prompt: 'team-session-summary' },
            undefined,
            [
                {
                    name: 'team-session-summary',
                    description: 'team prompt',
                    capabilities: { requiresTeamScope: true },
                    handler: () => ({ messages: [] }),
                },
            ]
        )
        expect(promptTargets).toEqual([
            {
                targetName: 'team-session-summary',
                targetType: 'prompt',
                capabilities: { requiresTeamScope: true },
            },
        ])
        const emptyUriTargets = resolvePromptOrResourceAccessTargets(
            'memory://team/recent',
            { uri: '   ' },
            undefined,
            []
        )
        expect(emptyUriTargets?.[1]?.targetName).toBe('memory://team/recent')

        expect(extractAuditScopeFromUri('memory://graph/companion')).toEqual({ workspaceId: 'companion' })
        expect(extractAuditScopeFromUri('memory://actions/recent/companion')).toEqual({
            workspaceId: 'companion',
        })
        expect(extractAuditScopeFromUri('memory://github/status/companion')).toEqual({
            workspaceId: 'companion',
        })
        expect(extractAuditScopeFromUri('memory://milestones/companion/4')).toEqual({
            workspaceId: 'companion',
        })
        expect(extractAuditScopeFromUri('memory://kanban/companion/16')).toEqual({
            workspaceId: 'companion',
            projectNumber: 16,
        })
        expect(extractAuditScopeFromUri('memory://projects/16/timeline')).toEqual({
            projectNumber: 16,
        })
        expect(extractAuditScopeFromUri('memory://commits/16/by-pr?project_number=0')).toEqual({})

        const cfgDir = makeTempDir('mj-p67-srv-')
        const db = new DatabaseAdapter(path.join(cfgDir, 'srv.db'))
        await db.initialize()
        const runtime = new ServerRuntime()
        const cfgManager = new ConfigManager({
            rawToolFilter: 'codemode',
            codemodeInternalFullAccess: true,
            briefingConfig: DEFAULT_BRIEFING_CONFIG,
        })
        try {
            const allTools: ToolRegistration[] = getTools(db, null, undefined, undefined, { runtime })
            const allToolNames = new Set(allTools.map((t) => t.name))
            const handlers = new Map<string, (req: unknown, extra: unknown) => Promise<unknown>>()
            handlers.set('tools/call', () =>
                Promise.resolve({
                    isError: true,
                    content: [{ type: 'text', text: 'MCP error -32602: Input validation error: bad' }],
                })
            )
            attachCallToolInterceptor(
                handlers,
                { db, runtime, configManager: cfgManager, allowedIoRoots: [] },
                { name: 'test', version: '1.0.0', transport: 'stdio' },
                [],
                allTools,
                allToolNames,
                { runtime, filterConfig: parseToolFilter('codemode'), codemodeInternalFullAccess: true }
            )
            const blockedCall = (await handlers.get('tools/call')!(
                { method: 'tools/call', params: { name: 'delete_entry', arguments: {} } },
                {}
            )) as { isError?: boolean; content?: { text?: string }[] }
            expect(blockedCall.isError).toBe(true)
            expect(blockedCall.content?.[0]?.text).toContain('VALIDATION_ERROR')

            const seeded = seedInitialBriefingScopeFromFile(
                { rawToolFilter: undefined, toolFilterConfig: null, briefingConfig: DEFAULT_BRIEFING_CONFIG },
                { defaultWorkspaceId: '__proto__' }
            )
            expect(seeded.briefingConfig.defaultWorkspaceId).toBeUndefined()

            // AP1..AP4: Pass 67 prompt revision and embedded detector rules
            expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass92')
            const cqText =
                getCodeQualityAuditPromptDefinition().handler({ target: 'src', copilot: 'false' }, db)
                    .messages[0]?.content.text ?? ''
            expect(cqText).toContain('Prompt revision: 2026-11-24-audit-pass92')
            expect(cqText).toContain('explore')
            expect(cqText).toContain('generalPurpose')
            expect(cqText).toContain('code-quality-audit')
            expect(cqText).toContain('param-normalizer.ts')
            expect(cqText).toContain('SCAN_OK scanned=')
            expect(cqText).toContain('Present the plan as markdown in the chat.')
            expect(cqText).toContain('Do not add an audit plan file to the repository.')
            expect(cqText).not.toContain('docs/audits/')
            expect(cqText).not.toContain('Cursor canvas')
            expect(cqText).not.toContain('invoke_subagent')
            expect(cqText).not.toContain('bun path/to/commit.ts')
            expect(cqText).toContain('json-entry-recovery.ts')
            expect(cqText).toContain('collapseTeamMirrors')
            expect(cqText).toContain('toValidationFailureResponse')
            expect(cqText).toContain('listBackups')
        } finally {
            cfgManager.close()
            db.close()
        }
    }, 30_000)

    it('B-L4: updateBadges skips autoCommitDirtyBadgeFiles when process.exitCode is 1', () => {
        const badgeDir = makeTempDir('mj-p67-badge-')
        const runBadgeGit = (args: string[]): string =>
            execFileSync('git', args, {
                cwd: badgeDir,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            }).trim()
        runBadgeGit(['init'])
        runBadgeGit(['config', 'user.email', 'test@example.com'])
        runBadgeGit(['config', 'user.name', 'Test User'])
        fs.mkdirSync(path.join(badgeDir, 'scripts'), { recursive: true })
        fs.writeFileSync(path.join(badgeDir, 'scripts', 'commit.ts'), '// stub\n', 'utf-8')
        fs.writeFileSync(path.join(badgeDir, 'DOCKER_README.md'), 'init\n', 'utf-8')
        runBadgeGit(['add', '.'])
        runBadgeGit(['commit', '-m', 'init'])
        fs.writeFileSync(path.join(badgeDir, 'DOCKER_README.md'), 'dirty\n', 'utf-8')
        fs.mkdirSync(path.join(badgeDir, 'README.md'))
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
        vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        updateBadges({ rootDir: badgeDir })
        expect(process.exitCode).toBe(1)
        expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Auto-committing'))
    }, 30_000)

    it('B-L5: enrichCommits preserves per-commit raw and action metadata across refCache hits', async () => {
        const gitDir = makeTempDir('mj-p67-git-')
        const runGit = (args: string[]): string =>
            execFileSync('git', args, {
                cwd: gitDir,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            }).trim()
        runGit(['init'])
        runGit(['config', 'user.email', 'test@example.com'])
        runGit(['config', 'user.name', 'Test User'])
        fs.writeFileSync(path.join(gitDir, 'a.txt'), '1\n', 'utf-8')
        runGit(['add', '.'])
        runGit(['commit', '-m', 'fixes #42'])
        const sha1 = runGit(['rev-parse', 'HEAD'])
        fs.writeFileSync(path.join(gitDir, 'a.txt'), '2\n', 'utf-8')
        runGit(['add', '.'])
        runGit(['commit', '-m', 'closes #42'])
        const sha2 = runGit(['rev-parse', 'HEAD'])

        const ghRef = {
            isApiAvailable: () => true,
            getCachedRepoInfo: () => ({ owner: 'org', repo: 'repo' }),
            getIssue: vi.fn().mockResolvedValue({ title: 'Issue 42', state: 'open', milestone: null }),
            getPullRequest: vi.fn().mockResolvedValue(null),
        } as unknown as GitHubIntegration
        const enriched = await enrichCommits(gitDir, [sha1, sha2], ghRef)
        expect(enriched[0]?.references[0]?.action).toBe('fixes')
        expect(enriched[0]?.references[0]?.raw).toBe('fixes #42')
        expect(enriched[1]?.references[0]?.action).toBe('closes')
        expect(enriched[1]?.references[0]?.raw).toBe('closes #42')
    }, 30_000)
})
