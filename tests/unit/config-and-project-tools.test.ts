/**
 * Unit Tests for ConfigManager, update_configuration, and Project Registry Admin Tools
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import {
    handleUpdateConfiguration,
    updateConfigurationSchema,
} from '../../src/handlers/tools/admin/update_configuration.js'
import { getProjectTools } from '../../src/handlers/tools/admin/project-tools.js'
import { getLifecycleTools } from '../../src/handlers/tools/admin/lifecycle-tools.js'
import { getMiscTools } from '../../src/handlers/tools/admin/misc-tools.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import type { ToolContext, ToolHandlerConfig } from '../../src/types/index.js'

describe('ConfigManager & Configuration Tools', () => {
    let tmpDir: string
    let originalConfigEnv: string | undefined

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-config-test-'))
        originalConfigEnv = process.env['MEMORY_JOURNAL_CONFIG']
    })

    afterEach(() => {
        if (originalConfigEnv !== undefined) {
            process.env['MEMORY_JOURNAL_CONFIG'] = originalConfigEnv
        } else {
            delete process.env['MEMORY_JOURNAL_CONFIG']
        }
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true })
        } catch {
            // ignore cleanup errors
        }
    })

    describe('ConfigManager', () => {
        it('should manage in-memory config when no configFilePath is provided', () => {
            const mgr = new ConfigManager({
                rawToolFilter: 'starter',
                toolFilterConfig: null,
                briefingConfig: { ...DEFAULT_BRIEFING_CONFIG },
            })
            expect(mgr.getConfig().rawToolFilter).toBe('starter')

            const listener = vi.fn()
            mgr.on('changed', listener)

            mgr.updateConfig({ rawToolFilter: 'full', codemodeInternalFullAccess: true }, false)
            expect(mgr.getConfig().rawToolFilter).toBe('full')
            expect(mgr.getConfig().toolFilterConfig).not.toBeNull()
            expect(mgr.getConfig().codemodeInternalFullAccess).toBe(true)
            expect(listener).toHaveBeenCalledTimes(1)

            // Clearing rawToolFilter sets toolFilterConfig to null
            mgr.updateConfig({ rawToolFilter: '' }, false)
            expect(mgr.getConfig().toolFilterConfig).toBeNull()

            mgr.close()
        })

        it('should persist and reload JSON configuration files', () => {
            const jsonPath = path.join(tmpDir, 'config.json')
            fs.writeFileSync(jsonPath, JSON.stringify({ toolFilter: 'core' }), 'utf-8')

            const mgr = new ConfigManager(
                {
                    rawToolFilter: 'core',
                    toolFilterConfig: null,
                    briefingConfig: { ...DEFAULT_BRIEFING_CONFIG },
                },
                jsonPath
            )
            // Immediately close watcher to avoid EPERM on Windows when temp directory is deleted
            mgr.close()

            mgr.updateConfig(
                {
                    rawToolFilter: 'full',
                    codemodeInternalFullAccess: true,
                    briefingConfig: {
                        ...DEFAULT_BRIEFING_CONFIG,
                        entryCount: 10,
                        summaryCount: 2,
                        includeTeam: true,
                        issueCount: 5,
                        prCount: 4,
                        prStatusBreakdown: true,
                        milestoneCount: 2,
                        workflowCount: 3,
                        workflowStatusBreakdown: true,
                        copilotReviews: true,
                    },
                },
                true
            )

            const savedRaw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Record<
                string,
                unknown
            >
            expect(savedRaw['toolFilter']).toBe('full')
            expect(savedRaw['briefingEntries']).toBe(10)
            expect(savedRaw['briefingIncludeTeam']).toBe(true)

            // Modify file externally and invoke private reloadFromFile directly
            fs.writeFileSync(
                jsonPath,
                JSON.stringify({
                    toolFilter: 'starter',
                    codemodeInternalFullAccess: false,
                    briefingEntries: 4,
                    briefingSummaries: 1,
                    briefingIncludeTeam: false,
                    briefingIssues: 2,
                    briefingPrs: 1,
                    briefingPrStatus: false,
                    briefingMilestones: 1,
                    briefingWorkflows: 1,
                    briefingWorkflowStatus: false,
                    briefingCopilot: false,
                }),
                'utf-8'
            )

            const changeListener = vi.fn()
            mgr.on('changed', changeListener)
            ;(mgr as unknown as { reloadFromFile: () => void }).reloadFromFile()

            expect(mgr.getConfig().rawToolFilter).toBe('starter')
            expect(mgr.getConfig().briefingConfig.entryCount).toBe(4)
            expect(mgr.getConfig().briefingConfig.includeTeam).toBe(false)
            expect(changeListener).toHaveBeenCalledTimes(1)
        })

        it('should persist and reload YAML configuration files', () => {
            const yamlPath = path.join(tmpDir, 'config.yaml')
            fs.writeFileSync(yamlPath, 'toolFilter: starter\n', 'utf-8')

            const mgr = new ConfigManager(
                {
                    rawToolFilter: 'starter',
                    toolFilterConfig: null,
                    briefingConfig: { ...DEFAULT_BRIEFING_CONFIG },
                },
                yamlPath
            )
            mgr.close()

            mgr.updateConfig({ rawToolFilter: 'full' }, true)

            const yamlText = fs.readFileSync(yamlPath, 'utf-8')
            expect(yamlText).toContain('toolFilter: full')

            fs.writeFileSync(yamlPath, 'toolFilter: core\nbriefingEntries: 6\n', 'utf-8')
            ;(mgr as unknown as { reloadFromFile: () => void }).reloadFromFile()
            expect(mgr.getConfig().rawToolFilter).toBe('core')
            expect(mgr.getConfig().briefingConfig.entryCount).toBe(6)
        })

        it('should handle reloadFromFile and persistToFile errors gracefully', () => {
            const missingPath = path.join(tmpDir, 'nonexistent.json')
            const mgr = new ConfigManager(
                {
                    rawToolFilter: 'core',
                    toolFilterConfig: null,
                    briefingConfig: { ...DEFAULT_BRIEFING_CONFIG },
                },
                missingPath
            )
            mgr.close()

            // Persist when file doesn't exist catches error gracefully
            expect(() => mgr.updateConfig({ rawToolFilter: 'full' }, true)).not.toThrow()
            expect(() =>
                (mgr as unknown as { reloadFromFile: () => void }).reloadFromFile()
            ).not.toThrow()

            const badJsonPath = path.join(tmpDir, 'bad.json')
            fs.writeFileSync(badJsonPath, '{ invalid json ', 'utf-8')
            const mgr2 = new ConfigManager(
                {
                    rawToolFilter: 'core',
                    toolFilterConfig: null,
                    briefingConfig: { ...DEFAULT_BRIEFING_CONFIG },
                },
                badJsonPath
            )
            mgr2.close()
            expect(() =>
                (mgr2 as unknown as { reloadFromFile: () => void }).reloadFromFile()
            ).not.toThrow()
        })
    })

    describe('update_configuration Tool & Schema', () => {
        it('should preprocess nested config, filter alias, string project_number, and strip hallucinated keys', () => {
            const parsed = updateConfigurationSchema.parse({
                config: {
                    filter: 'starter',
                    project_number: '#5',
                    briefing_entries: 7,
                },
                session_id: 'ignored-session',
                notes: 'ignored-note',
            })
            expect(parsed.tool_filter).toBe('starter')
            expect(parsed.project_number).toBe(5)
            expect(parsed.briefing_entries).toBe(7)
        })

        it('should strip unparseable string project_number in preprocessor', () => {
            const parsed = updateConfigurationSchema.parse({
                project_number: 'invalid-num',
                briefing_include_team: false,
            })
            expect(parsed.project_number).toBeUndefined()
            expect(parsed.briefing_include_team).toBe(false)
        })

        it('should throw when Runtime or ConfigManager is not available', () => {
            expect(() =>
                handleUpdateConfiguration({ tool_filter: 'starter' }, {} as ToolHandlerConfig)
            ).toThrow('Runtime is not available')

            expect(() =>
                handleUpdateConfiguration(
                    { tool_filter: 'starter' },
                    { runtime: {} as never } as ToolHandlerConfig
                )
            ).toThrow('ConfigManager is not initialized')
        })

        it('should update all briefing and tool_filter fields via ConfigManager', async () => {
            const mgr = new ConfigManager({
                rawToolFilter: 'starter',
                toolFilterConfig: null,
                briefingConfig: { ...DEFAULT_BRIEFING_CONFIG },
            })
            const config: ToolHandlerConfig = {
                runtime: { configManager: mgr } as never,
            }

            const res = await handleUpdateConfiguration(
                {
                    tool_filter: 'full',
                    briefing_entries: 8,
                    briefing_summaries: 2,
                    briefing_include_team: true,
                    briefing_issues: 5,
                    briefing_prs: 3,
                    briefing_pr_status: true,
                    briefing_milestones: 4,
                    briefing_workflows: 2,
                    briefing_workflow_status: true,
                    briefing_copilot: true,
                },
                config
            )
            expect(res.success).toBe(true)
            expect(res.updated).toContain('tool_filter')
            expect(res.updated).toContain('briefing_entries')
            expect(res.updated).toContain('briefing_copilot')
            expect(mgr.getConfig().rawToolFilter).toBe('full')
            expect(mgr.getConfig().briefingConfig.entryCount).toBe(8)
            expect(mgr.getConfig().briefingConfig.copilotReviews).toBe(true)
        })
    })

    describe('Project Registry Admin Tools (project-tools.ts)', () => {
        let configPath: string
        let db: DatabaseAdapter
        let context: ToolContext

        beforeEach(async () => {
            configPath = path.join(tmpDir, 'mj-projects.json')
            process.env['MEMORY_JOURNAL_CONFIG'] = configPath
            db = new DatabaseAdapter(':memory:')
            await db.initialize()
            context = {
                db,
                config: {
                    projectRegistry: {},
                },
            }
        })

        afterEach(() => {
            db.close()
        })

        it('should register, get, list, update (including rename), and delete projects in the registry', async () => {
            const tools = getProjectTools(context)
            const registerTool = tools.find((t) => t.name === 'register_project')!
            const updateTool = tools.find((t) => t.name === 'update_project')!
            const deleteTool = tools.find((t) => t.name === 'delete_project')!
            const listTool = tools.find((t) => t.name === 'list_projects')!
            const getTool = tools.find((t) => t.name === 'get_project')!

            // 1. Register project
            const regRes = (await registerTool.handler({
                name: 'test-proj',
                absolute_path: '/workspace/test-proj',
                project_number: 10,
            })) as {
                success: boolean
                project: { name: string; path: string; project_number: number }
            }
            expect(regRes.success).toBe(true)
            expect(regRes.project.name).toBe('test-proj')
            expect(regRes.project.project_number).toBe(10)

            // 2. Get project by name and by project_number
            const getRes = (await getTool.handler({ name: 'test-proj' })) as {
                success: boolean
                project: { name: string; path: string; project_number: number }
            }
            expect(getRes.success).toBe(true)
            expect(getRes.project.path).toBe('/workspace/test-proj')

            const getByNum = (await getTool.handler({ project_number: 10 })) as {
                success: boolean
                project: { name: string }
            }
            expect(getByNum.success).toBe(true)
            expect(getByNum.project.name).toBe('test-proj')

            // 3. Get nonexistent project
            const getMissing = (await getTool.handler({ name: 'missing' })) as {
                success: boolean
                error: string
            }
            expect(getMissing.success).toBe(false)
            expect(getMissing.error).toContain('Project not found')

            // 4. List projects
            const listRes = (await listTool.handler({})) as {
                success: boolean
                items: { name: string; projectNumber?: number }[]
            }
            expect(listRes.success).toBe(true)
            expect(listRes.items).toHaveLength(1)
            expect(listRes.items[0]?.projectNumber).toBe(10)

            // 5. Update project (including new_name rename)
            const updRes = (await updateTool.handler({
                name: 'test-proj',
                new_name: 'renamed-proj',
                absolute_path: '/workspace/updated-proj',
                project_number: 20,
            })) as {
                success: boolean
                project: { name: string; path: string; project_number: number }
            }
            expect(updRes.success).toBe(true)
            expect(updRes.project.name).toBe('renamed-proj')
            expect(updRes.project.path).toBe('/workspace/updated-proj')
            expect(updRes.project.project_number).toBe(20)

            // 6. Update nonexistent project
            const updMissing = (await updateTool.handler({
                name: 'missing',
                absolute_path: '/foo',
            })) as { success: boolean; error: string }
            expect(updMissing.success).toBe(false)
            expect(updMissing.error).toContain('Project not found')

            // 7. Delete project
            const delRes = (await deleteTool.handler({ name: 'renamed-proj' })) as {
                success: boolean
                message: string
            }
            expect(delRes.success).toBe(true)
            expect(delRes.message).toContain('deleted')

            // 8. Delete already-deleted project
            const delMissing = (await deleteTool.handler({ name: 'renamed-proj' })) as {
                success: boolean
                error: string
            }
            expect(delMissing.success).toBe(false)
            expect(delMissing.error).toContain('Project not found')
        })
    })

    describe('Lifecycle & Misc Admin Tools', () => {
        let db: DatabaseAdapter
        let context: ToolContext

        beforeEach(async () => {
            db = new DatabaseAdapter(':memory:')
            await db.initialize()
            context = { db, config: {} }
        })

        afterEach(() => {
            db.close()
        })

        it('should run run_auto_prune in dry_run and live modes', async () => {
            db.createEntry({ content: 'Entry for lifecycle test', tags: ['keep-me'] })

            const tools = getLifecycleTools(context)
            const pruneTool = tools.find((t) => t.name === 'run_auto_prune')!

            const dryRes = (await pruneTool.handler({
                archive_older_than_days: 30,
                prune_older_than_days: 90,
                hard_delete_older_than_days: 30,
                importance_threshold: 0.5,
                dry_run: true,
            })) as { success: boolean; dryRun: boolean; archivedCount: number }

            expect(dryRes.success).toBe(true)
            expect(dryRes.dryRun).toBe(true)

            const liveRes = (await pruneTool.handler({
                archive_older_than_days: 30,
                prune_older_than_days: 90,
                hard_delete_older_than_days: 30,
                importance_threshold: 0.5,
                dry_run: false,
            })) as { success: boolean; dryRun: boolean }

            expect(liveRes.success).toBe(true)
            expect(liveRes.dryRun).toBe(false)
        })

        it('should handle search_audit_log when auditLogger is disabled or enabled', async () => {
            const tools = getMiscTools(context)
            const searchAuditTool = tools.find((t) => t.name === 'search_audit_log')!

            // Disabled fallback
            const disabledRes = (await searchAuditTool.handler({ limit: 10 })) as {
                success: boolean
                count: number
                warning?: string
            }
            expect(disabledRes.success).toBe(true)
            expect(disabledRes.count).toBe(0)
            expect(disabledRes.warning).toContain('disabled')

            // Enabled mock
            const mockSearch = vi.fn().mockResolvedValue([
                {
                    timestamp: new Date().toISOString(),
                    requestId: 'req-1',
                    tool: 'create_entry',
                    category: 'write',
                    scope: 'write',
                    user: null,
                    scopes: [],
                    durationMs: 5,
                    success: true,
                },
            ])
            const enabledTools = getMiscTools({
                db,
                config: {
                    runtime: {
                        auditLogger: { search: mockSearch } as never,
                    } as never,
                },
            })
            const enabledAuditTool = enabledTools.find((t) => t.name === 'search_audit_log')!
            const enabledRes = (await enabledAuditTool.handler({
                tool_name: 'create_entry',
                limit: 5,
            })) as { success: boolean; count: number }
            expect(enabledRes.success).toBe(true)
            expect(enabledRes.count).toBe(1)
        })
    })
})
