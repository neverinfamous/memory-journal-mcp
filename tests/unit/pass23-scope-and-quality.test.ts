import { describe, it, expect, vi } from 'vitest'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { startMetricsServer } from '../../src/observability/metrics-server.js'
import { AuditLogger, getAuditResourceDef } from '../../src/audit/index.js'
import { auditOperation } from '../../src/audit/interceptor.js'
import { GitHubIntegration } from '../../src/github/github-integration/index.js'
import { RepositoryManager } from '../../src/github/github-integration/repository.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { readResource } from '../../src/handlers/resources/index.js'
import {
    DEFAULT_BRIEFING_CONFIG,
    type BriefingConfig,
} from '../../src/handlers/resources/shared.js'
import { getWorkflowPromptDefinitions } from '../../src/handlers/prompts/workflow.js'
import { getLoadBriefingPromptDefinitions } from '../../src/handlers/prompts/load-briefing.js'
import { getAdversarialPromptDefinitions } from '../../src/handlers/prompts/adversarial.js'
import { sanitizeCopilotTarget } from '../../src/handlers/prompts/adversarial-helpers.js'
import {
    auditArgsSchema,
    planReviewArgsSchema,
    validateAdversarialPromptScope,
} from '../../src/handlers/prompts/adversarial-args.js'
import { evaluateAnchorStaleness } from '../../src/handlers/tools/git-staleness.js'
import { getActiveSessionProject } from '../../src/utils/workspace-resolver.js'
import { ValidationError } from '../../src/types/errors.js'

function getFreeLoopbackPort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = net.createServer()
        srv.once('error', reject)
        srv.listen(0, '127.0.0.1', () => {
            const addr = srv.address()
            const port = typeof addr === 'object' && addr !== null ? addr.port : 0
            srv.close((closeErr) => {
                if (closeErr !== undefined && closeErr !== null) {
                    reject(closeErr)
                } else {
                    resolve(port)
                }
            })
        })
    })
}

async function httpGet(
    port: number,
    reqPath: string,
    headers: Record<string, string> = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    const attemptOnce = (): Promise<{
        status: number
        headers: http.IncomingHttpHeaders
        body: string
    }> =>
        new Promise((resolve, reject) => {
            const req = http.request(
                {
                    hostname: '127.0.0.1',
                    port,
                    path: reqPath,
                    method: 'GET',
                    headers,
                },
                (res) => {
                    const chunks: Buffer[] = []
                    res.on('data', (chunk: Buffer) => chunks.push(chunk))
                    res.on('end', () => {
                        resolve({
                            status: res.statusCode ?? 0,
                            headers: res.headers,
                            body: Buffer.concat(chunks).toString('utf8'),
                        })
                    })
                }
            )
            req.once('error', reject)
            req.end()
        })

    for (let i = 0; i < 15; i++) {
        try {
            return await attemptOnce()
        } catch (err: unknown) {
            const code =
                typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined
            if (code === 'ECONNREFUSED' && i < 14) {
                await new Promise((r) => setTimeout(r, 25))
                continue
            }
            throw err
        }
    }
    throw new Error('Metrics server failed to accept connections in time')
}

async function createMemoryDb(): Promise<DatabaseAdapter> {
    const db = new DatabaseAdapter(':memory:')
    await db.initialize()
    return db
}

describe('Pass 23 Scope Isolation & Code Quality Regressions', () => {
    describe('H31: metrics server port validation, Host check, and Bearer auth', () => {
        it('rejects out-of-range ports with RangeError', () => {
            const runtime = new ServerRuntime()
            expect(() => startMetricsServer(runtime, -1)).toThrow(RangeError)
            expect(() => startMetricsServer(runtime, 70000)).toThrow(RangeError)
        })

        it('enforces loopback Host header and Bearer authentication on /metrics', async () => {
            const runtime = new ServerRuntime()
            const port = await getFreeLoopbackPort()
            const stopServer = startMetricsServer(runtime, port, {
                authToken: 'secret-pass23-token',
            })
            try {
                const badHost = await httpGet(port, '/metrics', { Host: 'evil.example.com' })
                expect(badHost.status).toBe(403)

                const unauth = await httpGet(port, '/metrics')
                expect(unauth.status).toBe(401)
                expect(unauth.headers['www-authenticate']).toBe('Bearer')

                const wrongToken = await httpGet(port, '/metrics', {
                    Authorization: 'Bearer wrong-token',
                })
                expect(wrongToken.status).toBe(401)

                const authorized = await httpGet(port, '/metrics', {
                    Authorization: 'Bearer secret-pass23-token',
                })
                expect(authorized.status).toBe(200)
                expect(authorized.body).toContain('mcp_server_info')
            } finally {
                await stopServer()
            }
        })
    })

    describe('H32: audit logging captures sensitive reads and filters memory://audit by workspace', () => {
        it('audits sensitive team resource reads even when auditReads=false and filters by workspace_id', async () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass23-audit-'))
            const logPath = path.join(tmpDir, 'audit.jsonl')
            const db = await createMemoryDb()
            const logger = new AuditLogger({
                enabled: true,
                logPath,
                redact: false,
                auditReads: false,
                maxSizeBytes: 1_000_000,
            })
            try {
                await auditOperation(
                    logger,
                    'resource',
                    'memory://tags',
                    () => Promise.resolve('tags-ok'),
                    { resourceUri: 'memory://tags?workspace_id=repo-a' }
                )

                await auditOperation(
                    logger,
                    'resource',
                    'memory://team/recent',
                    () => Promise.resolve('team-a-ok'),
                    { resourceUri: 'memory://team/recent?workspace_id=repo-a&project_number=10' }
                )

                await auditOperation(
                    logger,
                    'resource',
                    'memory://team/recent',
                    () => Promise.resolve('team-b-ok'),
                    { resourceUri: 'memory://team/recent?workspace_id=repo-b&project_number=20' }
                )

                const recent = await logger.recent(10)
                expect(recent.some((e) => e.tool === 'memory://tags')).toBe(false)
                const repoAEntry = recent.find((e) => e.workspaceId === 'repo-a')
                expect(repoAEntry).toBeDefined()
                expect(repoAEntry?.category).toBe('team')
                expect(repoAEntry?.projectNumber).toBe(10)

                const auditDef = getAuditResourceDef(() => logger)
                const result = await auditDef.handler('memory://audit?workspace_id=repo-a', { db })
                const text = typeof result.data === 'string' ? result.data : JSON.stringify(result.data)
                expect(text).toContain('repo-a')
                expect(text).not.toContain('repo-b')
            } finally {
                await logger.close()
                db.close()
                fs.rmSync(tmpDir, { recursive: true, force: true })
            }
        })
    })

    describe('H24: GitHub CWD isolation and projectRegistry enforcement', () => {
        it('does not leak CWD repo metadata when querying an explicit foreign owner/repo', async () => {
            const spy = vi.spyOn(RepositoryManager.prototype, 'getRepoInfo').mockResolvedValue({
                owner: 'cwd-org',
                repo: 'cwd-repo',
                branch: 'cwd-branch',
                remoteUrl: 'https://github.com/cwd-org/cwd-repo',
            })
            try {
                const gh = new GitHubIntegration('.')
                const ctx = await gh.getRepoContext(undefined, {
                    owner: 'target-org',
                    repo: 'target-repo',
                })
                expect(ctx.repoName).toBe('target-repo')
                expect(ctx.branch).toBeNull()
                expect(ctx.remoteUrl).toBe('https://github.com/target-org/target-repo')
            } finally {
                spy.mockRestore()
            }
        })

        it('rejects unregistered workspace_id and project_number when projectRegistry is configured', async () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass23-gh-'))
            const db = await createMemoryDb()
            try {
                const gh = new GitHubIntegration(tmpDir)
                const issuesSpy = vi.spyOn(gh, 'getIssues').mockResolvedValue([])
                vi.spyOn(gh, 'getCachedRepoInfo').mockReturnValue({
                    owner: 'testowner',
                    repo: 'cwd-repo',
                    branch: 'main',
                    remoteUrl: 'https://github.com/testowner/cwd-repo',
                })
                vi.spyOn(gh, 'getRepoInfo').mockResolvedValue({
                    owner: 'testowner',
                    repo: 'cwd-repo',
                    branch: 'main',
                    remoteUrl: 'https://github.com/testowner/cwd-repo',
                })

                const config = {
                    runtime: new ServerRuntime(),
                    projectRegistry: {
                        'my-repo': { path: tmpDir, project_number: 5 },
                    },
                }

                const badWorkspaceResult = await callTool(
                    'get_github_issues',
                    { workspace_id: 'unregistered-repo' },
                    db,
                    undefined,
                    gh,
                    config
                )
                expect(badWorkspaceResult).toMatchObject({
                    success: false,
                    code: 'VALIDATION_ERROR',
                })

                const badProjectResult = await callTool(
                    'get_github_issues',
                    { project_number: 999 },
                    db,
                    undefined,
                    gh,
                    config
                )
                expect(badProjectResult).toMatchObject({
                    success: false,
                    code: 'VALIDATION_ERROR',
                })
                expect(issuesSpy).not.toHaveBeenCalled()
            } finally {
                db.close()
                fs.rmSync(tmpDir, { recursive: true, force: true })
            }
        })
    })

    describe('H27-H30: workflow wildcard guard, multi-project briefing pinning, and URI normalization', () => {
        it('rejects wildcard workspace_id on session-summary prompt', async () => {
            const db = await createMemoryDb()
            try {
                const summaryPrompt = getWorkflowPromptDefinitions().find(
                    (p) => p.name === 'session-summary'
                )
                expect(summaryPrompt).toBeDefined()
                expect(() => summaryPrompt?.handler({ workspace_id: '*' }, db)).toThrow(
                    ValidationError
                )
            } finally {
                db.close()
            }
        })

        it('keeps primary session project pinned when reading secondary ?pin_session=false briefings and normalizes agent-context URIs', async () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass23-brief-'))
            const dirA = path.join(tmpDir, 'repo-a')
            const dirB = path.join(tmpDir, 'repo-b')
            fs.mkdirSync(dirA)
            fs.mkdirSync(dirB)
            const db = await createMemoryDb()
            const runtime = new ServerRuntime()
            const briefingConfig: BriefingConfig = {
                ...DEFAULT_BRIEFING_CONFIG,
                projectRegistry: {
                    'repo-a': { path: dirA, project_number: 1 },
                    'repo-b': { path: dirB, project_number: 2 },
                },
            }
            try {
                const loadPrompt = getLoadBriefingPromptDefinitions().find(
                    (p) => p.name === 'load-briefing'
                )
                expect(loadPrompt).toBeDefined()
                const promptResult = await Promise.resolve(
                    loadPrompt?.handler(
                        { projects: 'repo-a,repo-b' },
                        db,
                        undefined,
                        undefined,
                        briefingConfig,
                        runtime
                    )
                )
                const promptText = promptResult?.messages[0]?.content.text ?? ''
                expect(promptText).toContain('memory://briefing/repo-a')
                expect(promptText).toContain('memory://briefing/repo-b?pin_session=false')

                await readResource(
                    'memory://briefing/repo-a',
                    db,
                    undefined,
                    null,
                    null,
                    undefined,
                    briefingConfig,
                    runtime
                )
                await readResource(
                    'memory://briefing/repo-b?pin_session=false',
                    db,
                    undefined,
                    null,
                    null,
                    undefined,
                    briefingConfig,
                    runtime
                )

                expect(getActiveSessionProject(runtime)).toEqual({
                    workspaceId: 'repo-a',
                    projectNumber: 1,
                })

                const agentCtx = await readResource(
                    'memory://agent-context/default?foo=1#bar',
                    db,
                    undefined,
                    null,
                    null,
                    undefined,
                    briefingConfig,
                    new ServerRuntime()
                )
                expect(typeof agentCtx.data).toBe('string')
                expect(agentCtx.data).toContain('Workspace ID: default')
            } finally {
                db.close()
                fs.rmSync(tmpDir, { recursive: true, force: true })
            }
        })
    })

    describe('L6: Windows drive-letter case-folding in anchor staleness checks', () => {
        it('resolves valid anchors without false path traversal when root and anchor drive letters differ in case', async () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass23-stale-'))
            const filePath = path.join(tmpDir, 'file.ts')
            fs.writeFileSync(filePath, 'export const ok = true;\n', 'utf8')
            const db = await createMemoryDb()
            try {
                const resolvedDir = path.resolve(tmpDir)
                let rootArg = resolvedDir
                let anchorArg = 'file.ts'
                if (process.platform === 'win32' && /^[A-Za-z]:/.test(resolvedDir)) {
                    rootArg = resolvedDir.charAt(0).toLowerCase() + resolvedDir.slice(1)
                    anchorArg =
                        resolvedDir.charAt(0).toUpperCase() +
                        resolvedDir.slice(1) +
                        path.sep +
                        'file.ts'
                }

                const row = await evaluateAnchorStaleness(
                    db,
                    { id: 1, anchorPath: anchorArg, status: 'pending' },
                    new Date(0).toISOString(),
                    rootArg,
                    () => Promise.resolve(0),
                    'default'
                )
                expect(row.newStatus).toBe('valid')
                expect(row.error).toBeUndefined()
            } finally {
                db.close()
                fs.rmSync(tmpDir, { recursive: true, force: true })
            }
        })
    })

    describe('P1-P7: adversarial prompt hardening, schemas, sanitizer, and scope validation', () => {
        it('includes hardened shared preamble, scan exclusions, and project_number argument in audit prompts', async () => {
            const db = await createMemoryDb()
            try {
                const defs = getAdversarialPromptDefinitions()
                const codeQuality = defs.find((p) => p.name === 'adversarial-audit-code-quality')
                const security = defs.find((p) => p.name === 'adversarial-audit-security')
                expect(codeQuality).toBeDefined()
                expect(security).toBeDefined()
                expect(codeQuality?.arguments?.some((a) => a.name === 'project_number')).toBe(true)

                const cqResult = await Promise.resolve(codeQuality?.handler({}, db))
                const cqText = cqResult?.messages[0]?.content.text ?? ''
                expect(cqText).toContain('Prompt revision: 2026-11-19-audit-pass43')
                expect(cqText).toContain('This prompt is shared by every project')
                expect(cqText).toContain('DO audit executable tool calls')
                expect(cqText).toContain('.wrangler')
                expect(cqText).toContain('*.d.ts')

                const secResult = await Promise.resolve(security?.handler({}, db))
                const secText = secResult?.messages[0]?.content.text ?? ''
                expect(secText).toContain('Prompt revision: 2026-11-19-audit-pass43')
                expect(secText).toContain('This prompt is shared by every project')
            } finally {
                db.close()
            }
        })

        it('preserves {target} placeholders while stripping shell metacharacters in sanitizeCopilotTarget', () => {
            expect(sanitizeCopilotTarget('{target}')).toBe('{target}')
            const cleaned = sanitizeCopilotTarget('src/a.ts; rm -rf / | $(id)')
            expect(cleaned).not.toMatch(/[;|$()]/)
            expect(cleaned).toContain('src/a.ts')
        })

        it('normalizes audit and plan-review arguments via Zod schemas', () => {
            expect(
                auditArgsSchema.parse({
                    target: '   ',
                    copilot: 'YES',
                    project_number: '#5',
                    workspace_id: '',
                })
            ).toEqual({
                target: undefined,
                copilot: 'true',
                project_number: 5,
                workspace_id: undefined,
            })

            expect(
                planReviewArgsSchema.parse({
                    depth: 'DEEP',
                    copilot: '0',
                })
            ).toEqual({
                depth: 'deep',
                copilot: 'false',
            })
        })

        it('validates adversarial prompt workspace and project_number scope consistency', () => {
            const cfg: Partial<BriefingConfig> = {
                projectRegistry: {
                    'repo-a': { path: '/tmp/repo-a', project_number: 1 },
                    'repo-b': { path: '/tmp/repo-b', project_number: 2 },
                },
            }

            expect(() => validateAdversarialPromptScope('*', undefined, cfg)).toThrow(
                ValidationError
            )
            expect(() => validateAdversarialPromptScope('repo-a', 2, cfg)).toThrow(ValidationError)
            expect(validateAdversarialPromptScope(undefined, 2, cfg)).toEqual({
                effectiveWorkspaceId: 'repo-b',
                projectNumber: 2,
            })
        })
    })
})
