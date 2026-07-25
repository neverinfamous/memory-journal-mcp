import { describe, it, expect, vi } from 'vitest'
import { resolveProjectContext, resolveWorkspaceId } from '../../src/utils/workspace-resolver.js'
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

    it('infers project from tag when workspace_id and project_number are omitted', () => {
        const res = resolveProjectContext(
            {
                content: 'Refactored OCC fuzzing tools',
                tags: ['mysql-mcp', 'fuzzing']
            },
            mockConfig
        )
        expect(res.workspaceId).toBe('mysql-mcp')
        expect(res.projectNumber).toBe(9)
    })

    it('infers project from content text when workspace_id and project_number are omitted', () => {
        const res = resolveProjectContext(
            {
                content: '# mysql-mcp core OCC tools fuzzing test report\n\nAdded new tests',
                tags: ['session-summary']
            },
            mockConfig
        )
        expect(res.workspaceId).toBe('mysql-mcp')
        expect(res.projectNumber).toBe(9)
    })

    it('returns undefined projectNumber when no keywords or explicit IDs match and cwd is unregistered', () => {
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
            expect(res.projectNumber).toBeUndefined()
        } finally {
            spy.mockRestore()
        }
    })

    it('auto-corrects unregistered project_number (like 7) when content matches a registered workspace', () => {
        const res = resolveProjectContext(
            {
                project_number: 7, // Unregistered project number
                content: 'Tested mysql-mcp stats_moving_avg and mysql_stats_ntile',
                tags: ['journal']
            },
            mockConfig
        )
        expect(res.workspaceId).toBe('mysql-mcp')
        expect(res.projectNumber).toBe(9) // Corrected from 7 to mysql-mcp's registered project_number 9
    })

    it('falls back safely without creating ghost project number when project_number is unregistered and no keywords match', () => {
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
            expect(res.projectNumber).toBeUndefined() // Does NOT keep unregistered 7
        } finally {
            spy.mockRestore()
        }
    })

    it('resolveWorkspaceId helper delegates accurately', () => {
        const wsId = resolveWorkspaceId(
            undefined,
            undefined,
            mockConfig,
            'Working on adamic codebase enhancements',
            ['dev']
        )
        expect(wsId).toBe('adamic')
    })
})
