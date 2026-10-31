/**
 * Extended Unit Tests for Tool Handlers:
 * - Team Member Tools (src/handlers/tools/team/member-tools.ts)
 * - Team Alias Tools (src/handlers/tools/team/alias-tools.ts)
 * - Team IO Tools (src/handlers/tools/team/io-tools.ts)
 * - Personal IO Tools (src/handlers/tools/io/tools.ts)
 * - Admin Core Tools (src/handlers/tools/admin/core-tools.ts)
 * - Core Tools (src/handlers/tools/core/tools.ts)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { getTeamMemberTools } from '../../src/handlers/tools/team/member-tools.js'
import { getTeamAliasTools } from '../../src/handlers/tools/team/alias-tools.js'
import { getTeamIoTools } from '../../src/handlers/tools/team/io-tools.js'
import { getIoTools } from '../../src/handlers/tools/io/tools.js'
import { getCoreTools as getAdminCoreTools } from '../../src/handlers/tools/admin/core-tools.js'
import { getCoreTools } from '../../src/handlers/tools/core/tools.js'
import type { ToolContext, ToolDefinition } from '../../src/types/index.js'

function findTool(tools: ToolDefinition[], name: string): ToolDefinition {
    const found = tools.find((t) => t.name === name)
    if (!found) throw new Error(`Tool ${name} not found`)
    return found
}

describe('Extended Tool Handlers (Team, IO, Admin, Core)', () => {
    let tmpDir: string
    let ioRoot: string
    let db: DatabaseAdapter
    let teamDb: DatabaseAdapter
    let context: ToolContext

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-handlers-ext-'))
        ioRoot = path.join(process.cwd(), '.test-output', `handlers-io-${String(Date.now())}`)
        fs.mkdirSync(ioRoot, { recursive: true })

        db = new DatabaseAdapter(path.join(tmpDir, 'personal.db'))
        await db.initialize()

        teamDb = new DatabaseAdapter(path.join(tmpDir, 'team.db'))
        await teamDb.initialize()
        teamDb.applyTeamSchema()

        context = {
            db,
            teamDb,
            config: {
                defaultProjectNumber: 5,
                allowedIoRoots: [ioRoot],
            },
        }
    })

    afterEach(() => {
        try {
            db.close()
        } catch {
            // ignore
        }
        try {
            teamDb.close()
        } catch {
            // ignore
        }
        fs.rmSync(tmpDir, { recursive: true, force: true })
        fs.rmSync(ioRoot, { recursive: true, force: true })
    })

    describe('Team Member Tools (src/handlers/tools/team/member-tools.ts)', () => {
        it('should handle team_add_member, team_list_members, team_get_member, team_update_member_role, and team_remove_member with parameter aliases', async () => {
            const tools = getTeamMemberTools(context)

            // 1. Add member using alias keys ('user' -> 'author', 'level' -> 'role')
            const addRes = (await findTool(tools, 'team_add_member').handler({
                user: 'alice',
                level: 'admin',
                display_name: 'Alice Admin',
            })) as { success: boolean }
            expect(addRes.success).toBe(true)

            // 2. Add second member
            await findTool(tools, 'team_add_member').handler({
                author: 'bob',
                role: 'viewer',
            })

            // 3. List members
            const listRes = (await findTool(tools, 'team_list_members').handler({})) as {
                success: boolean
                count: number
            }
            expect(listRes.success).toBe(true)
            expect(listRes.count).toBe(2)

            // 4. Get member (found vs not found)
            const getRes = (await findTool(tools, 'team_get_member').handler({
                name: 'alice',
            })) as { success: boolean }
            expect(getRes.success).toBe(true)

            const getMissing = (await findTool(tools, 'team_get_member').handler({
                author: 'nonexistent',
            })) as { success: boolean; code: string }
            expect(getMissing.success).toBe(false)
            expect(getMissing.code).toBe('RESOURCE_NOT_FOUND')

            // 5. Update member role (found vs not found)
            const updRes = (await findTool(tools, 'team_update_member_role').handler({
                target: 'bob',
                permission: 'member',
            })) as { success: boolean }
            expect(updRes.success).toBe(true)

            const updMissing = (await findTool(tools, 'team_update_member_role').handler({
                author: 'nonexistent',
                role: 'viewer',
            })) as { success: boolean; code: string }
            expect(updMissing.success).toBe(false)
            expect(updMissing.code).toBe('RESOURCE_NOT_FOUND')

            // 6. Remove member (cannot remove self when TEAM_AUTHOR matches)
            const prevAuthor = process.env['TEAM_AUTHOR']
            process.env['TEAM_AUTHOR'] = 'alice'
            try {
                const selfRem = (await findTool(tools, 'team_remove_member').handler({
                    author: 'alice',
                })) as { success: boolean; code: string }
                expect(selfRem.success).toBe(false)
                expect(selfRem.code).toBe('VALIDATION_ERROR')

                const bobRem = (await findTool(tools, 'team_remove_member').handler({
                    member: 'bob',
                })) as { success: boolean }
                expect(bobRem.success).toBe(true)
            } finally {
                if (prevAuthor === undefined) delete process.env['TEAM_AUTHOR']
                else process.env['TEAM_AUTHOR'] = prevAuthor
            }

            // 7. Missing teamDb fallback
            const noTeamTools = getTeamMemberTools({ db })
            const noTeamRes = (await findTool(noTeamTools, 'team_list_members').handler({})) as {
                success: boolean
            }
            expect(noTeamRes.success).toBe(false)
        })
    })

    describe('Team Alias Tools (src/handlers/tools/team/alias-tools.ts)', () => {
        it('should manage author aliases, preprocessing aliases, and consolidation', async () => {
            // Register an actual member so RBAC is active (otherwise resolveTeamRole returns 'admin' for everyone)
            teamDb.addTeamMember('admin-user', 'admin')

            const tools = getTeamAliasTools(context)

            // Cannot alias an existing team member
            const roleErr = (await findTool(tools, 'team_add_author_alias').handler({
                alias: 'admin-user',
                canonical_author: 'someone',
            })) as { error?: string }
            expect(roleErr.error).toContain('existing team member')

            // Add alias using alias keys ('from' -> 'alias', 'to' -> 'canonical_author')
            const addRes = (await findTool(tools, 'team_add_author_alias').handler({
                from: 'chris-dev',
                to: 'chris-main',
            })) as { success: boolean }
            expect(addRes.success).toBe(true)

            // List aliases using search key ('q')
            const listRes = (await findTool(tools, 'team_list_author_aliases').handler({
                q: 'chris-main',
            })) as { success: boolean; aliases: unknown[] }
            expect(listRes.success).toBe(true)
            expect(listRes.aliases.length).toBe(1)

            // Resolve author
            const resAuthor = (await findTool(tools, 'team_resolve_author').handler({
                author: 'chris-dev',
            })) as { canonical_author: string; is_aliased: boolean }
            expect(resAuthor.canonical_author).toBe('chris-main')
            expect(resAuthor.is_aliased).toBe(true)

            // Consolidate authors
            teamDb.createEntry({ content: 'Team entry by alias', author: 'chris-dev' })
            const consRes = (await findTool(tools, 'team_consolidate_authors').handler({
                target: 'chris-main',
            })) as { success: boolean; updated_count: number }
            expect(consRes.success).toBe(true)
            expect(consRes.updated_count).toBe(1)

            // Remove alias (found vs not found)
            const remRes = (await findTool(tools, 'team_remove_author_alias').handler({
                name: 'chris-dev',
            })) as { success: boolean }
            expect(remRes.success).toBe(true)

            const remMissing = (await findTool(tools, 'team_remove_author_alias').handler({
                alias: 'chris-dev',
            })) as { error?: string }
            expect(remMissing.error).toBeDefined()
        })
    })

    describe('Team IO Tools & Personal IO Tools (team/io-tools.ts, io/tools.ts)', () => {
        it('should export and import markdown and external files for both personal and team journals', async () => {
            // Seed entries in personal and team DBs
            db.createEntry({
                content: 'Personal entry for IO test',
                entryType: 'technical_note',
                tags: ['io-tag'],
                projectNumber: 5,
            })
            teamDb.createEntry({
                content: 'Team entry for IO test',
                entryType: 'project_decision',
                tags: ['team-io'],
                projectNumber: 5,
                author: 'alice',
            })

            const ioTools = getIoTools(context)
            const teamIoTools = getTeamIoTools(context)

            // 1. Personal export_entries (json & markdown formats, date/tag/type filters)
            const expJson = (await findTool(ioTools, 'export_entries').handler({
                format: 'json',
                tags: ['io-tag'],
                entry_types: ['technical_note'],
            })) as { format: string; count: number }
            expect(expJson.format).toBe('json')
            expect(expJson.count).toBe(1)

            const expMdStr = (await findTool(ioTools, 'export_entries').handler({
                format: 'markdown',
                start_date: '2020-01-01',
                end_date: '2030-12-31',
            })) as { format: string; content: string }
            expect(expMdStr.format).toBe('markdown')
            expect(expMdStr.content).toContain('Personal entry for IO test')

            // 2. Personal export_markdown & import_markdown
            const personalMdDir = path.join(ioRoot, 'personal-md')
            const expMdFiles = (await findTool(ioTools, 'export_markdown').handler({
                output_dir: personalMdDir,
                entry_types: ['technical_note'],
            })) as { exported_count: number }
            expect(expMdFiles.exported_count).toBe(1)

            const impMdFiles = (await findTool(ioTools, 'import_markdown').handler({
                source_dir: personalMdDir,
                dry_run: true,
            })) as { updated: number; dry_run: boolean }
            expect(impMdFiles.dry_run).toBe(true)
            expect(impMdFiles.updated).toBe(1)

            // 3. Team export_markdown & team_import_markdown (including 'tmp_team_md' shortcut & date range)
            const teamExpRes = (await findTool(teamIoTools, 'team_export_markdown').handler({
                output_dir: 'tmp_team_md',
                project_number: 5,
                start_date: '2020-01-01',
            })) as { exported_count: number }
            expect(teamExpRes.exported_count).toBe(1)

            const teamImpRes = (await findTool(teamIoTools, 'team_import_markdown').handler({
                source_dir: 'tmp_team_md',
                project_number: 5,
                dry_run: false,
            })) as { updated: number }
            expect(teamImpRes.updated).toBe(1)

            // 4. Team import_external (obsidian format)
            const extDir = path.join(ioRoot, 'team-ext')
            fs.mkdirSync(extDir, { recursive: true })
            fs.writeFileSync(
                path.join(extDir, 'ext.md'),
                '---\ntags:\n  - ext\n---\nExternal team note content\n',
                'utf-8'
            )
            const teamExtRes = (await findTool(teamIoTools, 'team_import_external').handler({
                source_dir: extDir,
                source_format: 'obsidian',
                project_number: 5,
            })) as { created: number }
            expect(teamExtRes.created).toBe(1)

            // 5. Team IO fallback when teamDb is not configured
            const disabledTeamIo = getTeamIoTools({ db })
            for (const name of ['team_export_markdown', 'team_import_markdown', 'team_import_external']) {
                const res = (await findTool(disabledTeamIo, name).handler({})) as {
                    success: boolean
                }
                expect(res.success).toBe(false)
            }
        })
    })

    describe('Admin Core Tools & Core Tools (admin/core-tools.ts, core/tools.ts)', () => {
        it('should handle create_entry (with team sharing), update_entry, delete_entry (with concurrency check), restore_entry, history, and error test tools', async () => {
            const coreTools = getCoreTools(context)
            const adminTools = getAdminCoreTools(context)

            // 1. create_entry with share_with_team and relationships
            const prevAuthor = process.env['TEAM_AUTHOR']
            process.env['TEAM_AUTHOR'] = 'chris-tester'
            let createdId: number
            try {
                const createRes = (await findTool(coreTools, 'create_entry').handler({
                    content:
                        '## Accomplished\nCreated via core tool handler\n\n## Unfinished / Blocked\nNone\n\n## Context for Next Session\nContinue\n\n## Commits\n- abc1234',
                    entry_type: 'retrospective',
                    tags: ['session-summary'],
                    workspace_id: 'memory-journal-mcp',
                    project_number: 5,
                    impact_score: 0.7,
                    trust_score: 0.9,
                    validation_status: 'passed',
                    share_with_team: true,
                    relationships: [{ targetId: 9999, relationType: 'references' }],
                })) as { success: boolean; id: number; sharedWithTeam?: boolean }
                expect(createRes.success).toBe(true)
                expect(createRes.sharedWithTeam).toBe(true)
                createdId = createRes.id
            } finally {
                if (prevAuthor === undefined) delete process.env['TEAM_AUTHOR']
                else process.env['TEAM_AUTHOR'] = prevAuthor
            }

            // 2. get_entry_by_id (with relationships & importance)
            const getRes = (await findTool(coreTools, 'get_entry_by_id').handler({
                entry_id: createdId,
                include_relationships: true,
            })) as { success: boolean; importance: number }
            expect(getRes.success).toBe(true)
            expect(typeof getRes.importance).toBe('number')

            // 3. update_entry & get_entry_history
            const updRes = (await findTool(adminTools, 'update_entry').handler({
                entry_id: createdId,
                content: '## Accomplished\nUpdated content',
                workspace_id: 'memory-journal-mcp',
                project_number: 5,
            })) as { success: boolean }
            expect(updRes.success).toBe(true)

            const histRes = (await findTool(coreTools, 'get_entry_history').handler({
                entry_id: createdId,
                workspace_id: 'memory-journal-mcp',
                project_number: 5,
            })) as { success: boolean; history: unknown[] }
            expect(histRes.success).toBe(true)
            expect(histRes.history.length).toBe(1)

            // 4. delete_entry with expected_version mismatch -> CONCURRENCY_ERROR
            const delConflict = (await findTool(adminTools, 'delete_entry').handler({
                entry_id: createdId,
                workspace_id: 'memory-journal-mcp',
                expected_version: 999,
            })) as { success: boolean; code: string }
            expect(delConflict.success).toBe(false)
            expect(delConflict.code).toBe('CONCURRENCY_ERROR')

            // 5. delete_entry & restore_entry (using 'id' alias)
            const delOk = (await findTool(adminTools, 'delete_entry').handler({
                entry_id: createdId,
            })) as { success: boolean }
            expect(delOk.success).toBe(true)

            const restoreOk = (await findTool(adminTools, 'restore_entry').handler({
                id: createdId,
            })) as { success: boolean }
            expect(restoreOk.success).toBe(true)

            // 6. list_tags, test_simple, test_error_handling
            const tagsRes = (await findTool(coreTools, 'list_tags').handler({})) as {
                success: boolean
                count: number
            }
            expect(tagsRes.success).toBe(true)
            expect(tagsRes.count).toBeGreaterThanOrEqual(1)

            const echoRes = (await findTool(coreTools, 'test_simple').handler({
                message: 'hello',
            })) as { success: boolean; message: string }
            expect(echoRes.message).toBe('Echo: hello')

            for (const errType of ['zod', 'type', 'database', 'memory_journal', 'generic']) {
                const errRes = (await findTool(coreTools, 'test_error_handling').handler({
                    error_type: errType,
                    message: `Simulated ${errType}`,
                })) as { error?: string }
                expect(errRes.error).toBeDefined()
            }
        })
    })
})
