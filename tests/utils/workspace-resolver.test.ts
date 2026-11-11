import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'
import { cwdMatchesRegistryPath, resolveProjectContext, resolveWorkspaceId } from '../../src/utils/workspace-resolver.js'
import type { ToolHandlerConfig } from '../../src/types/index.js'

describe('workspace-resolver with keyword and tag inference', () => {
    const mockConfig: ToolHandlerConfig = {
        defaultWorkspaceId: 'default',
        defaultProjectNumber: 1,
        projectRegistry: {
            'mysql-mcp': {
                path: 'C:\\Users\\chris\\Desktop\\mysql-mcp',
                project_number: 9
            },
            'memory-journal-mcp': {
                path: 'C:\\Users\\chris\\Desktop\\memory-journal-mcp',
                project_number: 5
            },
            'adamic': {
                path: 'C:\\Users\\chris\\Desktop\\adamic',
                project_number: 16
            }
        }
    }

    it('resolves explicit project_number and looks up workspaceId', () => {
        const res = resolveProjectContext({ project_number: 9 }, mockConfig)
        expect(res.projectNumber).toBe(9)
        expect(res.workspaceId).toBe('mysql-mcp')
    })

    it('resolves explicit workspace_id and looks up project_number', () => {
        const res = resolveProjectContext({ workspace_id: 'adamic' }, mockConfig)
        expect(res.workspaceId).toBe('adamic')
        expect(res.projectNumber).toBe(16)
    })

    it('infers project from tag when workspace, project, and cwd are all unresolved', () => {
        const spy = vi.spyOn(process, 'cwd').mockReturnValue('C:\\tmp\\unregistered-project')
        try {
            const res = resolveProjectContext(
                {
                    content: 'Refactored OCC fuzzing tools',
                    tags: ['mysql-mcp', 'fuzzing']
                },
                mockConfig
            )
            expect(res.workspaceId).toBe('mysql-mcp')
            expect(res.projectNumber).toBe(9)
        } finally {
            spy.mockRestore()
        }
    })

    it('infers project from content text when workspace, project, and cwd are all unresolved', () => {
        const spy = vi.spyOn(process, 'cwd').mockReturnValue('C:\\tmp\\unregistered-project')
        try {
            const res = resolveProjectContext(
                {
                    content: '# mysql-mcp core OCC tools fuzzing test report\n\nAdded new tests',
                    tags: ['session-summary']
                },
                mockConfig
            )
            expect(res.workspaceId).toBe('mysql-mcp')
            expect(res.projectNumber).toBe(9)
        } finally {
            spy.mockRestore()
        }
    })

    it('falls back to config.defaultProjectNumber when no keywords or explicit IDs match and cwd is unregistered', () => {
        const spy = vi.spyOn(process, 'cwd').mockReturnValue('C:\\tmp\\unregistered-project')
        try {
            const res = resolveProjectContext(
                {
                    content: 'Random general reflection with no project references',
                    tags: ['journal']
                },
                mockConfig
            )
            expect(res.workspaceId).toBe('default')
            expect(res.projectNumber).toBe(1)
        } finally {
            spy.mockRestore()
        }
    })

    it('returns undefined projectNumber when no keywords, explicit IDs, or defaultProjectNumber match and cwd is unregistered', () => {
        const spy = vi.spyOn(process, 'cwd').mockReturnValue('C:\\tmp\\unregistered-project')
        try {
            const res = resolveProjectContext(
                {
                    content: 'Random general reflection with no project references',
                    tags: ['journal']
                },
                { ...mockConfig, defaultProjectNumber: undefined }
            )
            expect(res.workspaceId).toBe('default')
            expect(res.projectNumber).toBeUndefined()
        } finally {
            spy.mockRestore()
        }
    })

    it('keeps an explicit unregistered project_number instead of retargeting from content keywords', () => {
        const spy = vi.spyOn(process, 'cwd').mockReturnValue('C:\\tmp\\unregistered-project')
        try {
            const res = resolveProjectContext(
                {
                    project_number: 7,
                    content: 'Tested mysql-mcp stats_moving_avg and mysql_stats_ntile',
                    tags: ['journal']
                },
                mockConfig
            )
            expect(res.workspaceId).toBe('default')
            expect(res.projectNumber).toBe(7)
        } finally {
            spy.mockRestore()
        }
    })

    it('pairs an explicit workspace with its registry project and ignores a conflicting project_number and cwd', () => {
        const spy = vi.spyOn(process, 'cwd').mockReturnValue('C:\\Users\\chris\\Desktop\\memory-journal-mcp\\src')
        try {
            const res = resolveProjectContext(
                {
                    workspace_id: 'adamic',
                    project_number: 5,
                    content: 'sqlite notes that must not retarget adamic',
                },
                mockConfig
            )
            expect(res.workspaceId).toBe('adamic')
            expect(res.projectNumber).toBe(16)
        } finally {
            spy.mockRestore()
        }
    })

    it('preserves explicit project_number when no workspace keywords conflict', () => {
        const spy = vi.spyOn(process, 'cwd').mockReturnValue('C:\\tmp\\unregistered-project')
        try {
            const res = resolveProjectContext(
                {
                    project_number: 7, // Unregistered project number
                    content: 'Random general reflection',
                    tags: ['journal']
                },
                mockConfig
            )
            expect(res.workspaceId).toBe('default')
            expect(res.projectNumber).toBe(7) // Preserves explicit project_number when no workspace keyword conflict occurs
        } finally {
            spy.mockRestore()
        }
    })

    it('does not treat a prefixed sibling directory as the registered project', () => {
        const root = path.join('C:\\Users\\chris\\Desktop', 'memory-journal-mcp')
        const wiki = path.join('C:\\Users\\chris\\Desktop', 'memory-journal-mcp.wiki')
        const child = path.join(root, 'src')
        expect(cwdMatchesRegistryPath(root, wiki)).toBe(false)
        expect(cwdMatchesRegistryPath(root, child)).toBe(true)
        expect(cwdMatchesRegistryPath(root, root)).toBe(true)
    })

    it('resolveWorkspaceId helper delegates accurately when cwd is not a registered project', () => {
        const spy = vi.spyOn(process, 'cwd').mockReturnValue('C:\\tmp\\unregistered-project')
        try {
            const wsId = resolveWorkspaceId(
                undefined,
                undefined,
                mockConfig,
                'Working on adamic codebase enhancements',
                ['dev']
            )
            expect(wsId).toBe('adamic')
        } finally {
            spy.mockRestore()
        }
    })

    it('resolves proper project instead of staying on "default" when workspace_id: "default" is passed alongside project_number, tags, content, or registered cwd', () => {
        // 1. Explicit project_number overrides soft workspace_id: 'default'
        const byProjectNum = resolveProjectContext(
            { workspace_id: 'default', project_number: 5, content: 'General entry' },
            mockConfig
        )
        expect(byProjectNum.workspaceId).toBe('memory-journal-mcp')
        expect(byProjectNum.projectNumber).toBe(5)

        // 2. Tag inference overrides soft workspace_id: 'default'
        const byTag = resolveProjectContext(
            { workspace_id: 'default', content: 'General note', tags: ['memory-journal-mcp'] },
            mockConfig
        )
        expect(byTag.workspaceId).toBe('memory-journal-mcp')
        expect(byTag.projectNumber).toBe(5)

        // 3. Content keyword inference overrides soft workspace_id: 'default'
        const byContent = resolveProjectContext(
            { workspace_id: 'default', content: 'Audit pass on memory-journal-mcp handlers' },
            mockConfig
        )
        expect(byContent.workspaceId).toBe('memory-journal-mcp')
        expect(byContent.projectNumber).toBe(5)

        // 4. Registered process.cwd() overrides soft workspace_id: 'default'
        const spy = vi.spyOn(process, 'cwd').mockReturnValue('C:\\Users\\chris\\Desktop\\memory-journal-mcp\\src')
        try {
            const byCwd = resolveProjectContext(
                { workspace_id: 'default', content: 'General commit note with no explicit repo keyword' },
                mockConfig
            )
            expect(byCwd.workspaceId).toBe('memory-journal-mcp')
            expect(byCwd.projectNumber).toBe(5)
        } finally {
            spy.mockRestore()
        }
    })

    it('prioritizes registered CWD over content/tag keywords when preferCwdOverKeywords is true (CLI mode)', () => {
        const adamicRoot = path.resolve('workspace-roots', 'adamic')
        const dbMcpRoot = path.resolve('workspace-roots', 'db-mcp')
        const cliRegistryConfig: ToolHandlerConfig = {
            defaultWorkspaceId: 'default',
            projectRegistry: {
                'db-mcp': {
                    path: dbMcpRoot,
                    project_number: 15,
                },
                adamic: {
                    path: adamicRoot,
                    project_number: 16,
                },
            },
        }

        const spy = vi.spyOn(process, 'cwd').mockReturnValue(path.join(adamicRoot, 'skills'))
        try {
            // Registered cwd wins over the sqlite alias in both MCP and CLI mode.
            const mcpResolved = resolveProjectContext(
                {
                    content: 'Updated sqlite skill documentation and rules',
                    tags: ['sqlite', 'docs'],
                },
                cliRegistryConfig
            )
            expect(mcpResolved.workspaceId).toBe('adamic')
            expect(mcpResolved.projectNumber).toBe(16)

            const cliResolved = resolveProjectContext(
                {
                    content: 'Updated sqlite skill documentation and rules',
                    tags: ['sqlite', 'docs'],
                    preferCwdOverKeywords: true,
                },
                cliRegistryConfig
            )
            expect(cliResolved.workspaceId).toBe('adamic')
            expect(cliResolved.projectNumber).toBe(16)

            // Explicit workspace_id or project_number still overrides CWD in CLI mode
            const explicitProject = resolveProjectContext(
                {
                    project_number: 15,
                    content: 'Cross-repo note logged from adamic CWD',
                    preferCwdOverKeywords: true,
                },
                cliRegistryConfig
            )
            expect(explicitProject.workspaceId).toBe('db-mcp')
            expect(explicitProject.projectNumber).toBe(15)
        } finally {
            spy.mockRestore()
        }
    })
})
