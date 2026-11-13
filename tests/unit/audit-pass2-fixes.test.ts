import { describe, expect, it } from 'vitest'
import { convertKeysToSnakeCase } from '../../src/codemode/api/param-normalizer.js'
import { createProjectsProxy } from '../../src/codemode/proxy-namespaces.js'
import { hasMethodToken } from '../../src/codemode/method-tokens.js'
import { createPreparedStatementShim } from '../../src/codemode/worker/node-shims.js'
import { projectAliasTarget } from '../../src/handlers/tools/core/dummy-healing/entry-fallbacks.js'
import { isSourceCodemodeDir } from '../../src/codemode/worker-sandbox.js'
import { applyDomainToolInterceptions } from '../../src/codemode/normalizers/domain-tool-interceptions.js'

describe('audit pass 2 fixes', () => {
    it('does not treat update_project as a GitHub tool', () => {
        const result = convertKeysToSnakeCase({ name: 'memory-journal-mcp' }, 'update_project')
        expect(result['title']).toBeUndefined()
        expect(hasMethodToken('update_project', 'pr')).toBe(false)
        expect(hasMethodToken('get_github_prs', 'prs')).toBe(true)
    })

    it('routes deleteAll to delete_project and getProjects to the list handler', async () => {
        const calls: string[] = []
        const projects = createProjectsProxy(
            {
                admin: ['list_projects', 'get_project', 'delete_project', 'update_project', 'register_project'],
            },
            (_group, method) => {
                calls.push(method)
                return Promise.resolve({ success: true })
            }
        )
        const namespace = projects as Record<string, (...args: unknown[]) => Promise<unknown>>
        const deleteAll = namespace['deleteAll']
        const getProjects = namespace['getProjects']
        if (deleteAll === undefined || getProjects === undefined) {
            throw new Error('project namespace is missing deleteAll or getProjects')
        }
        await deleteAll()
        await getProjects()
        expect(calls).toEqual(['delete_project', 'list_projects'])
    })

    it('routes plural project aliases to list_projects', () => {
        expect(projectAliasTarget('mj.core.getProjects')).toBe('list_projects')
        expect(projectAliasTarget('get_projects')).toBe('list_projects')
        expect(projectAliasTarget('mj.core.getProject')).toBe('get_project')
        expect(projectAliasTarget('get_project')).toBe('get_project')
        expect(projectAliasTarget('mj.projects.get')).toBe('get_project')
        expect(projectAliasTarget('mj.projects')).toBe('list_projects')
    })

    it('does not misroute non-alias project tools (M7)', () => {
        for (const name of ['delete_projects', 'update_projects', 'get_cross_project_insights', 'get_project_kanban']) {
            expect(projectAliasTarget(name)).toBeUndefined()
        }
    })

    it('returns the statement result instead of a fake success', async () => {
        const stmt = createPreparedStatementShim('UPDATE memory_journal SET content = ? WHERE id = 1', {})
        const run = stmt['run']
        if (typeof run !== 'function') throw new Error('prepared statement is missing run')
        const pending: unknown = run()
        expect(pending).toBeInstanceOf(Promise)
        const value: unknown = await pending
        if (typeof value !== 'object' || value === null || !('success' in value)) {
            throw new Error('run() did not return a result object')
        }
        expect(value.success).toBe(false)
    })

    it('matches only the src/codemode directory segment', () => {
        expect(isSourceCodemodeDir('C:\\repo\\src\\codemode')).toBe(true)
        expect(isSourceCodemodeDir('/repo/src/codemode')).toBe(true)
        expect(isSourceCodemodeDir('/repo/mysrc/codemode')).toBe(false)
    })

    it('keeps project_number on listDeletedEntries', () => {
        const result = applyDomainToolInterceptions('listDeletedEntries', [{ project_number: 5, limit: 10 }])
        if ('error' in result) throw new Error(result.error)
        const payload = result.args[0]
        if (typeof payload !== 'object' || payload === null || !('project_number' in payload)) {
            throw new Error('project_number was removed')
        }
        expect(payload.project_number).toBe(5)
    })
})
