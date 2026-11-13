import { describe, it, expect } from 'vitest'
import {
    getActiveSessionProject,
    resolveWorkspaceFromFilePath,
    setActiveSessionProject,
} from '../../src/utils/workspace-resolver.js'
import type { ToolHandlerConfig } from '../../src/types/index.js'

describe('workspace-resolver isolation regressions (pass 20)', () => {
    it('ignores registry entries with empty paths instead of matching every cwd', () => {
        const config: ToolHandlerConfig = {
            projectRegistry: {
                blank: { path: '', project_number: 3 },
                spaces: { path: '   ', project_number: 4 },
            },
        }
        expect(resolveWorkspaceFromFilePath(process.cwd(), config)).toBeUndefined()
        expect(resolveWorkspaceFromFilePath('', config)).toBeUndefined()
    })

    it('drops the previous project number when the session switches workspace', () => {
        const runtime = {}
        setActiveSessionProject('repo-a', 7, runtime)
        expect(getActiveSessionProject(runtime)).toEqual({ workspaceId: 'repo-a', projectNumber: 7 })
        setActiveSessionProject('repo-b', undefined, runtime)
        expect(getActiveSessionProject(runtime)).toEqual({ workspaceId: 'repo-b' })
    })

    it('keeps the project number when the same workspace is re-recorded without one', () => {
        const runtime = {}
        setActiveSessionProject('repo-a', 7, runtime)
        setActiveSessionProject('repo-a', undefined, runtime)
        expect(getActiveSessionProject(runtime)).toEqual({ workspaceId: 'repo-a', projectNumber: 7 })
    })
})
