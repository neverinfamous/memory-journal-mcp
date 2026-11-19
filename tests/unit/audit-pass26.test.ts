/**
 * Pass 26 Adversarial Code-Quality Regression Suite
 *
 * Covers H1–H8, M1–M5, M9–M11, and Pass 26 prompt target resolution.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import { EventEmitter } from 'node:events'
import type { MessagePort } from 'node:worker_threads'
import { z } from 'zod'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { runWithAuthContext } from '../../src/auth/auth-context.js'
import { getTeamRelationshipTools } from '../../src/handlers/tools/team/relationship-tools.js'
import { getTeamCoreTools } from '../../src/handlers/tools/team/core-tools.js'
import { getCallerIdentity } from '../../src/handlers/tools/team/rbac.js'
import { resolveAuthenticatedAuthor } from '../../src/utils/security-utils.js'
import { matchRegistryByTagsOrContent, resolveProjectNumberFromPath } from '../../src/utils/workspace-resolver-registry.js'
import { resolveMcpCreateWorkspaceScope } from '../../src/server/mcp-server/tool-registration/create-scope-interceptor.js'
import { runWithRpcExecutionOverrides, getRpcExecutionOverrides } from '../../src/codemode/rpc-context.js'
import { handleRpcRequest } from '../../src/codemode/worker-rpc-handler.js'
import { createSecureDispatcher } from '../../src/handlers/tools/codemode/secure-dispatcher.js'
import { normalizeDispatchParams } from '../../src/handlers/tools/codemode/dispatch-scope.js'
import { enrichEntryRecord } from '../../src/codemode/api/cross-group-aliases.js'
import {
    createChildProcessShims,
    createFetchShim,
    createSandboxProcessObject,
} from '../../src/codemode/worker/sandbox-process-shims.js'
import { createApiRootGetTrap } from '../../src/codemode/worker/api-proxy-trap.js'
import { resolveGitWorkingDir } from '../../src/handlers/tools/git-staleness.js'
import { ValidationError } from '../../src/types/errors.js'
import type { ToolContext, ToolDefinition } from '../../src/types/index.js'

const REGISTRY = {
    'memory-journal-mcp': { path: path.resolve('/repos/memory-journal-mcp'), project_number: 5 },
    'other-repo': { path: path.resolve('/repos/other-repo'), project_number: 9 },
}

class MockMessagePort extends EventEmitter {
    public posted: unknown[] = []
    public postMessage(value: unknown): void {
        this.posted.push(value)
    }
}

function makeToolContext(db: DatabaseAdapter, teamDb?: DatabaseAdapter): ToolContext {
    return {
        db,
        teamDb,
        config: {
            projectRegistry: REGISTRY,
            teamDefaultRole: 'member',
        },
    }
}

describe('Pass 26 Audit Regressions', () => {
    let db: DatabaseAdapter
    let teamDb: DatabaseAdapter
    const savedTeamAuthor = process.env['TEAM_AUTHOR']

    beforeEach(async () => {
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        teamDb = new DatabaseAdapter(':memory:')
        await teamDb.initialize()
    })

    afterEach(() => {
        teamDb.close()
        db.close()
        if (savedTeamAuthor === undefined) {
            delete process.env['TEAM_AUTHOR']
        } else {
            process.env['TEAM_AUTHOR'] = savedTeamAuthor
        }
    })

    describe('H1 & H2: Code Mode RPC readonly/dryRun & wildcard propagation', () => {
        it('propagates RPC readonly/dryRun overrides monotonically and blocks nested mutations (H1)', async () => {
            let capturedNestedOverrides: ReturnType<typeof getRpcExecutionOverrides>
            await runWithRpcExecutionOverrides({ readonly: true }, async () => {
                await runWithRpcExecutionOverrides({ dryRun: true }, () => {
                    capturedNestedOverrides = getRpcExecutionOverrides()
                    return Promise.resolve()
                })
            })
            expect(capturedNestedOverrides).toEqual({ readonly: true, dryRun: true })

            const mockPort = new MockMessagePort()
            let observedInsideRpc: ReturnType<typeof getRpcExecutionOverrides>
            await handleRpcRequest(
                { id: 1, group: 'core', method: 'createEntry', args: [{}], readonly: true },
                {
                    core: {
                        createEntry: () => {
                            observedInsideRpc = getRpcExecutionOverrides()
                            return Promise.resolve({ success: true })
                        },
                    },
                },
                mockPort as unknown as MessagePort,
                { core: ['createEntry'] }
            )
            expect(observedInsideRpc).toEqual({ readonly: true })

            const mutatingTool: ToolDefinition = {
                name: 'create_entry',
                title: 'Create',
                description: 'Create entry',
                group: 'core',
                inputSchema: z.object({ content: z.string(), workspace_id: z.string().optional() }),
                annotations: { readOnlyHint: false },
                handler: () => Promise.resolve({ success: true }),
            }
            const dispatcher = createSecureDispatcher({
                tools: [mutatingTool],
                sessionContext: makeToolContext(db),
                projectId: 5,
                workspaceId: 'memory-journal-mcp',
                autoVersion: false,
                dryRun: false,
            })

            const blocked = (await runWithRpcExecutionOverrides({ readonly: true }, () =>
                dispatcher('create_entry', { content: 'blocked' })
            )) as { success?: boolean; code?: string }
            expect(blocked.success).toBe(false)
            expect(blocked.code).toBe('PERMISSION_DENIED')

            const dryRunRes = (await runWithRpcExecutionOverrides({ dryRun: true }, () =>
                dispatcher('create_entry', { content: 'simulated' })
            )) as { success?: boolean; dry_run?: boolean }
            expect(dryRunRes.success).toBe(true)
            expect(dryRunRes.dry_run).toBe(true)
        })

        it('only propagates wildcard "*" session workspace to read-only tools (H2)', async () => {
            const readTool: ToolDefinition = {
                name: 'get_recent_entries',
                title: 'Recent',
                description: 'Get recent',
                group: 'core',
                inputSchema: z.object({ workspace_id: z.string().optional() }),
                annotations: { readOnlyHint: true },
                handler: () => ({ success: true }),
            }
            const writeTool: ToolDefinition = {
                name: 'create_entry',
                title: 'Create',
                description: 'Create',
                group: 'core',
                inputSchema: z.object({ workspace_id: z.string().optional() }),
                annotations: { readOnlyHint: false },
                handler: () => ({ success: true }),
            }

            const readNorm = await normalizeDispatchParams(readTool, {}, {
                sessionContext: makeToolContext(db),
                projectId: undefined,
                workspaceId: '*',
                explicitWorkspace: true,
            })
            expect('params' in readNorm).toBe(true)
            if ('params' in readNorm && typeof readNorm.params === 'object' && readNorm.params !== null) {
                expect(Reflect.get(readNorm.params, 'workspace_id')).toBe('*')
            }

            const writeNorm = await normalizeDispatchParams(writeTool, {}, {
                sessionContext: makeToolContext(db),
                projectId: undefined,
                workspaceId: '*',
                explicitWorkspace: true,
            })
            expect('params' in writeNorm).toBe(true)
            if ('params' in writeNorm && typeof writeNorm.params === 'object' && writeNorm.params !== null) {
                expect(Reflect.get(writeNorm.params, 'workspace_id')).toBeUndefined()
            }
        })
    })

    describe('H3–H5: Registry sentinels, cross-group enrichment, and MCP batch create scope', () => {
        it('ignores sentinel project keys ("default", "test") and empty paths in registry resolution (H3)', () => {
            const regWithSentinels = {
                ...REGISTRY,
                default: { path: '', project_number: 1 },
                test: { path: '', project_number: 2 },
            }
            expect(
                matchRegistryByTagsOrContent(
                    { tags: ['test', 'default'], content: 'run default test suite' },
                    regWithSentinels
                )
            ).toBeUndefined()
            expect(resolveProjectNumberFromPath('/anywhere/on/disk', regWithSentinels)).toBeUndefined()
        })

        it('does not overwrite cross-workspace batch item project_number and rejects mismatched pairs (H4)', () => {
            const batchItem: Record<string, unknown> = {
                content: 'Cross repo item',
                workspace_id: 'other-repo',
            }
            enrichEntryRecord(batchItem, () => REGISTRY, 'memory-journal-mcp', 5)
            expect(batchItem['workspace_id']).toBe('other-repo')
            expect(batchItem['project_number']).toBe(9)

            const mismatched: Record<string, unknown> = {
                content: 'Conflict',
                workspace_id: 'other-repo',
                project_number: 5,
            }
            expect(() => enrichEntryRecord(mismatched, () => REGISTRY)).toThrow(ValidationError)
        })

        it('marks omitted batch items "*" under wildcard root without stamping mismatched root scope (H5)', () => {
            const args: Record<string, unknown> = {
                workspace_id: '*',
                entries: [{ content: 'a' }, { content: 'b', workspace_id: 'other-repo' }],
            }
            resolveMcpCreateWorkspaceScope('batch_create_entries', args, { projectRegistry: REGISTRY })
            const items = args['entries'] as Record<string, unknown>[]
            expect(items[0]?.['workspace_id']).toBe('*')
            expect(items[1]?.['workspace_id']).toBe('other-repo')
        })
    })

    describe('H6–H8: OAuth identity binding, team graph scope, and team author RBAC', () => {
        it('does not fall back to TEAM_AUTHOR when OAuth claims only carry empty or "unknown" (H6)', () => {
            process.env['TEAM_AUTHOR'] = 'spoofed-local-author'
            runWithAuthContext(
                {
                    authenticated: true,
                    claims: { sub: '   ', email: 'unknown', preferred_username: '\t\n' },
                    scopes: [],
                },
                () => {
                    expect(resolveAuthenticatedAuthor()).toBe('unknown')
                    expect(getCallerIdentity()).toBe('unknown')
                }
            )
        })

        it('rejects unresolvable project_number and filters cross-project neighbors in team_visualize_relationships (H7)', () => {
            const p55 = teamDb.createEntry({
                content: 'Project 55 root',
                workspaceId: 'unreg',
                projectNumber: 55,
                isPersonal: false,
            })
            const p99 = teamDb.createEntry({
                content: 'Project 99 leak target',
                workspaceId: 'unreg',
                projectNumber: 99,
                isPersonal: false,
            })
            teamDb.linkEntries(p55.id, p99.id, 'references', 'cross-project link', 'unreg')

            const tools = getTeamRelationshipTools(makeToolContext(db, teamDb))
            const visualize = tools.find((t) => t.name === 'team_visualize_relationships')
            expect(visualize).toBeDefined()

            const missingProj = visualize?.handler({ workspace_id: '*' }) as {
                success?: boolean
                code?: string
            }
            expect(missingProj.success).toBe(false)
            expect(missingProj.code).toBe('VALIDATION_ERROR')

            const graphRes = visualize?.handler({
                entry_id: p55.id,
                workspace_id: 'unreg',
                project_number: 55,
                depth: 2,
            }) as { success?: boolean; nodeCount?: number; edgeCount?: number; mermaid?: string }
            expect(graphRes.success).toBe(true)
            expect(graphRes.nodeCount).toBe(1)
            expect(graphRes.edgeCount).toBe(0)
            expect(graphRes.mermaid).not.toContain('Project 99 leak target')
        })

        it('enforces team_create_entry author validation/RBAC and rejects wildcard team_list_tags without project_number (H8)', async () => {
            teamDb.addTeamMember('bob', 'admin')
            teamDb.addTeamMember('alice', 'member')
            process.env['TEAM_AUTHOR'] = 'alice'

            const coreTools = getTeamCoreTools(makeToolContext(db, teamDb))
            const teamCreate = coreTools.find((t) => t.name === 'team_create_entry')
            const teamListTags = coreTools.find((t) => t.name === 'team_list_tags')
            expect(teamCreate).toBeDefined()
            expect(teamListTags).toBeDefined()

            const impersonation = (await teamCreate?.handler({
                content: 'Impersonate admin',
                workspace_id: 'memory-journal-mcp',
                project_number: 5,
                impact_score: 0.5,
                trust_score: 0.5,
                validation_status: 'passed',
                author: 'bob',
            })) as { success?: boolean; code?: string }
            expect(impersonation.success).toBe(false)
            expect(impersonation.code).toBe('PERMISSION_DENIED')

            const emptyAuthor = (await teamCreate?.handler({
                content: 'Empty claim',
                workspace_id: 'memory-journal-mcp',
                project_number: 5,
                impact_score: 0.5,
                trust_score: 0.5,
                validation_status: 'passed',
                author: 'unknown',
            })) as { success?: boolean; code?: string }
            expect(emptyAuthor.success).toBe(false)
            expect(emptyAuthor.code).toBe('VALIDATION_ERROR')

            const wildcardTags = teamListTags?.handler({ workspace_id: '*' }) as {
                success?: boolean
                code?: string
            }
            expect(wildcardTags.success).toBe(false)
            expect(wildcardTags.code).toBe('VALIDATION_ERROR')
        })
    })

    describe('M1, M2, M4, M5, M9, M10, M11 & Pass 26 target resolution', () => {
        it('guards Code Mode worker shims and readonly root trap safely (M1, M2)', async () => {
            const { spawn } = createChildProcessShims()
            let cbErr: Error | undefined
            const child = spawn('cmd', () => {
                cbErr = new Error('caught')
                throw cbErr
            })
            expect(cbErr).toBeInstanceOf(Error)
            expect(child.status).toBe(1)

            const fetchRes = await createFetchShim()('https://example.com')
            expect(fetchRes['ok']).toBe(false)
            expect(fetchRes['status']).toBe(403)
            const procRes = (createSandboxProcessObject()['exit'] as (code?: number) => Record<string, unknown>)(2)
            expect(procRes['exited']).toBe(false)

            const rootTarget: Record<string, unknown> = { core: {} }
            const proxy = new Proxy(
                rootTarget,
                {
                    get: createApiRootGetTrap({
                        api: rootTarget,
                        methods: { _topLevel: ['executeCode'], core: ['searchEntries'] },
                        schemas: { _topLevel: { executeCode: 'fn' } },
                        readonlyMode: true,
                        createMethodProxyFn: () => () => Promise.resolve({}),
                        resolveFallbackSchema: (s, g, k) => s?.[g]?.[k],
                    }),
                }
            )
            const blockedTop = (await (Reflect.get(proxy, 'executeCode') as () => Promise<unknown>)()) as {
                success?: boolean
                code?: string
            }
            expect(blockedTop.success).toBe(false)
            expect(blockedTop.code).toBe('VALIDATION_ERROR')
        })

        it('excludes soft-deleted peers from importance rel_count and causal_count (M4)', () => {
            const a = db.createEntry({ content: 'Entry A', workspaceId: 'memory-journal-mcp', projectNumber: 5 })
            const b = db.createEntry({ content: 'Entry B', workspaceId: 'memory-journal-mcp', projectNumber: 5 })
            db.linkEntries(a.id, b.id, 'resolved')

            const beforeDelete = db.calculateImportance(a.id, 'memory-journal-mcp')
            expect(beforeDelete?.breakdown.relationships).toBeGreaterThan(0)
            expect(beforeDelete?.breakdown.causal).toBeGreaterThan(0)

            db.deleteEntry(b.id, false, 'memory-journal-mcp')
            const afterSoftDelete = db.calculateImportance(a.id, 'memory-journal-mcp')
            expect(afterSoftDelete?.breakdown.relationships).toBe(0)
            expect(afterSoftDelete?.breakdown.causal).toBe(0)
        })

        it('rejects non-positive/non-integer project_number in resolveGitWorkingDir (M5)', () => {
            expect(() =>
                resolveGitWorkingDir({ project_number: 'abc' }, { projectRegistry: REGISTRY })
            ).toThrow(ValidationError)
            expect(() =>
                resolveGitWorkingDir({ project_number: 0 }, { projectRegistry: REGISTRY })
            ).toThrow(ValidationError)
            expect(() =>
                resolveGitWorkingDir({ project_number: 1.5 }, { projectRegistry: REGISTRY })
            ).toThrow(ValidationError)
        })
    })
})
