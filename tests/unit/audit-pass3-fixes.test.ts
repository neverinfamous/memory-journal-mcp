import { describe, expect, it } from 'vitest'
import { getRequiredScope } from '../../src/auth/scope-map.js'
import { convertKeysToSnakeCase } from '../../src/codemode/api/key-normalizer.js'
import { applyDomainToolInterceptions } from '../../src/codemode/normalizers/domain-tool-interceptions.js'
import { applyGithubAndBackupInterceptions } from '../../src/codemode/normalizers/github-and-backup-interceptions.js'

describe('audit pass 3 fixes', () => {
    it('does not treat listDeletedEntries as a delete', () => {
        expect(getRequiredScope('mj.core.listDeletedEntries')).toBe('read')
        expect(getRequiredScope('mj.core.mergeTags')).toBe('admin')
        expect(getRequiredScope('mj.core.linkEntries')).toBe('write')
        expect(getRequiredScope('mj.core.restoreEntry')).toBe('admin')
        expect(getRequiredScope('mj.core.unknownVerb')).toBe('admin')
    })

    it('does not rewrite search titles into content', () => {
        const result = convertKeysToSnakeCase({ title: 'find me' }, 'searchEntries')
        expect(result['title']).toBe('find me')
        expect(result['content']).toBeUndefined()
    })

    it('maps project_id onto project_number for listDeletedEntries', () => {
        const result = applyDomainToolInterceptions('listDeletedEntries', [{ project_id: 7 }])
        if ('error' in result) throw new Error('project_id was rejected')
        const payload = result.args[0]
        if (typeof payload !== 'object' || payload === null) throw new Error('missing payload')
        expect(payload).toMatchObject({ project_number: 7 })
        expect('project_id' in payload).toBe(false)
    })

    it('forwards a numeric rebuildVectorIndex argument', () => {
        const result = applyDomainToolInterceptions('rebuildVectorIndex', [4])
        if ('error' in result) throw new Error('project number was rejected')
        expect(result.args[0]).toEqual({ project_number: 4 })
    })

    it('still remaps keep on the singular milestone tool', () => {
        const result = applyGithubAndBackupInterceptions('get_github_milestone', [{ keep: 3 }])
        if ('error' in result) throw new Error(JSON.stringify(result.error))
        const payload = result.args[0]
        if (typeof payload !== 'object' || payload === null) throw new Error('missing payload')
        expect(payload).toMatchObject({ milestone_number: 3 })
    })

    it('does not treat get_github_milestones as the singular milestone tool', () => {
        const result = applyGithubAndBackupInterceptions('get_github_milestones', [{ keep: 3 }])
        if ('error' in result) throw new Error(JSON.stringify(result.error))
        const payload = result.args[0]
        if (typeof payload !== 'object' || payload === null) throw new Error('missing payload')
        expect('milestone_number' in payload).toBe(false)
    })
})
