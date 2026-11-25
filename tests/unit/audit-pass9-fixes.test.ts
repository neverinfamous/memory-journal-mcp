import * as path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { resolveWorkspaceFromFilePath } from '../../src/utils/workspace-resolver.js'
import { buildPriorAuditSection, resolvePromptPriorWorkspace } from '../../src/handlers/prompts/adversarial-helpers.js'
import { resourceWorkspace } from '../../src/handlers/resources/shared.js'
import { getCoreTools as getAdminCoreTools } from '../../src/handlers/tools/admin/core-tools.js'
import { applyGenericInterceptions } from '../../src/codemode/normalizers/generic-interceptions.js'
import {
    extractAndRecoverPreparedStatementCode,
    extractAndRecoverSqlCode,
} from '../../src/handlers/tools/codemode/sql-recovery.js'
import { normalizeParams } from '../../src/codemode/api/param-normalizer.js'

describe('Pass 9 Audit Fixes — Workspace Routing & Normalizers', () => {
    const sampleRegistry = {
        'core-platform': {
            path: path.resolve('/workspace/core-platform'),
            project_number: 6,
        },
        'memory-journal-mcp': {
            path: path.resolve('/workspace/core-platform/repos/memory-journal-mcp'),
            project_number: 5,
        },
    }

    describe('resolveWorkspaceFromFilePath', () => {
        it('selects the most specific (longest) matching registered project path', () => {
            const subFile = path.resolve('/workspace/core-platform/repos/memory-journal-mcp/src/index.ts')
            const resolved = resolveWorkspaceFromFilePath(subFile, {
                projectRegistry: sampleRegistry,
            })
            expect(resolved).toEqual({
                workspaceId: 'memory-journal-mcp',
                projectNumber: 5,
            })
        })

        it('does not match a sibling prefix directory such as memory-journal-mcp.wiki', () => {
            const wikiFile = path.resolve('/workspace/core-platform/repos/memory-journal-mcp.wiki/Home.md')
            const resolved = resolveWorkspaceFromFilePath(wikiFile, {
                projectRegistry: sampleRegistry,
            })
            expect(resolved).toEqual({
                workspaceId: 'core-platform',
                projectNumber: 6,
            })
        })
    })

    describe('resolvePromptPriorWorkspace & buildPriorAuditSection', () => {
        it('resolves a subdirectory inside a registered project to that project instead of parent or default', () => {
            const targetSubdir = path.resolve(
                '/workspace/core-platform/repos/memory-journal-mcp/src/handlers/prompts'
            )
            const ws = resolvePromptPriorWorkspace(
                {
                    defaultWorkspaceId: 'default',
                    projectRegistry: sampleRegistry,
                },
                undefined,
                targetSubdir
            )
            expect(ws).toBe('memory-journal-mcp')
        })

        it('includes Journal Attribution Rule with workspace_id and project_number so audit entries never go to default', () => {
            const db = {
                searchByDateRange: vi.fn(() => ({ entries: [] })),
                searchEntries: vi.fn(() => ({ entries: [] })),
            }
            const section = buildPriorAuditSection(
                db as never,
                'code-quality-audit',
                'Prior code-quality audits',
                {
                    defaultWorkspaceId: 'default',
                    projectRegistry: sampleRegistry,
                },
                undefined,
                path.resolve('/workspace/core-platform/repos/memory-journal-mcp')
            )
            expect(section).toContain('workspace_id: "memory-journal-mcp"')
            expect(section).toContain('project_number: 5')
            expect(section).toContain('instead of `default`')
        })
    })

    describe('resourceWorkspace', () => {
        it('keeps an explicit default workspace instead of replacing it with the project registry workspace', () => {
            const ws = resourceWorkspace({
                briefingConfig: {
                    defaultWorkspaceId: 'default',
                    defaultProjectNumber: 5,
                    projectRegistry: sampleRegistry,
                },
            })
            expect(ws).toBe('default')
        })

        it('resolves an omitted workspace from defaultProjectNumber', () => {
            const ws = resourceWorkspace({
                briefingConfig: {
                    defaultProjectNumber: 5,
                    projectRegistry: sampleRegistry,
                },
            })
            expect(ws).toBe('memory-journal-mcp')
        })
    })

    describe('Admin Core Tools primary-key workspace resolution', () => {
        it('uses the existing entry workspace when caller omits workspace_id and project_number on update_entry', async () => {
            const updateEntry = vi.fn((_id: number, updates: Record<string, unknown>) => ({
                id: 42,
                workspaceId: updates['workspaceId'],
                content: updates['content'],
            }))
            const getEntryById = vi.fn((id: number, ws?: string) =>
                id === 42 && ws === '*' ? { id: 42, workspaceId: 'memory-journal-mcp' } : null
            )
            const tools = getAdminCoreTools({
                db: { updateEntry, getEntryById } as never,
                config: { defaultWorkspaceId: 'default' },
            })
            const updateTool = tools.find((t) => t.name === 'update_entry')
            expect(updateTool).toBeDefined()
            const res = (await updateTool?.handler({
                entry_id: 42,
                content: 'updated note',
            })) as { success: boolean }
            expect(res.success).toBe(true)
            expect(getEntryById).toHaveBeenCalledWith(42, '*')
            expect(updateEntry).toHaveBeenCalledWith(
                42,
                expect.objectContaining({ workspaceId: 'memory-journal-mcp' })
            )
        })

        it('preserves an explicit caller workspace_id so workspace-mismatch validation still runs', async () => {
            const updateEntry = vi.fn(() => null)
            const getEntryById = vi.fn()
            const tools = getAdminCoreTools({
                db: { updateEntry, getEntryById } as never,
                config: { defaultWorkspaceId: 'default', projectRegistry: sampleRegistry },
            })
            const updateTool = tools.find((t) => t.name === 'update_entry')
            await updateTool?.handler({
                entry_id: 42,
                workspace_id: 'other-project',
                content: 'updated note',
            })
            expect(getEntryById).not.toHaveBeenCalled()
            expect(updateEntry).toHaveBeenCalledWith(
                42,
                expect.objectContaining({ workspaceId: 'other-project' })
            )
        })
    })

    describe('Code Mode Generic Interceptions & Param Normalizer', () => {
        it('normalizeParams merges trailing options object on multi-arg calls', () => {
            const out = normalizeParams('getRecentEntries', [
                10,
                { projectNumber: 5, workspaceId: 'memory-journal-mcp', isPersonal: true },
            ])
            expect(out).toEqual({
                limit: 10,
                project_number: 5,
                workspace_id: 'memory-journal-mcp',
                is_personal: true,
            })
        })

        it('applyGenericInterceptions coerces string project_number to workspace_id when non-numeric', () => {
            const res = applyGenericInterceptions('search_entries', [
                { query: 'audit', project_number: 'memory-journal-mcp' },
            ])
            expect('error' in res).toBe(true)
            if ('error' in res) {
                expect(res.error['success']).toBe(false)
                expect(res.error['code']).toBe('VALIDATION_ERROR')
                expect(String(res.error['error'])).toContain('memory-journal-mcp')
            }
        })

        it('applyGenericInterceptions keeps a search query when a string is paired with options', () => {
            const res = applyGenericInterceptions('searchEntries', ['audit', { limit: 5 }])
            expect('args' in res && res.args[0]).toEqual({ limit: 5, query: 'audit' })
        })

        it('keeps workspace scope on healed DELETE and does not let a later number replace a literal id', () => {
            const deleted = extractAndRecoverSqlCode(
                "DELETE FROM memory_journal WHERE id = 12 AND workspace_id = 'core-platform'"
            )
            expect(deleted).toContain('mj.admin.deleteEntry')
            expect(deleted).toContain('"entry_id":12')
            expect(deleted).toContain('"workspace_id":"core-platform"')

            const updated = extractAndRecoverPreparedStatementCode(
                'db.prepare("UPDATE memory_journal SET content = ? WHERE id = 44").run("hello", 9);'
            )
            expect(updated).toContain('"entry_id":44')
            expect(updated).not.toContain('"entry_id":9')
        })
    })
})
