import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../src/types/errors.js'
import { buildExplicitAttributionArgs } from '../../src/handlers/prompts/workflow-helpers.js'
import { resolvePromptPriorWorkspace } from '../../src/handlers/prompts/adversarial-helpers.js'
import { getAgentContextResource } from '../../src/handlers/resources/core/agent-context.js'
import { extractAndRecoverPreparedStatementCode } from '../../src/handlers/tools/codemode/sql-recovery.js'
import { createSecureDispatcher } from '../../src/handlers/tools/codemode/secure-dispatcher.js'
import type { ToolContext, ToolDefinition } from '../../src/types/index.js'
import { createPreparedStatementShim } from '../../src/codemode/worker/node-shims.js'

const registry = {
    adamic: { project_number: 16 },
    'memory-journal-mcp': { project_number: 5 },
}

describe('Pass 18 audit fixes', () => {
    it('rejects a generated createEntry project number that belongs to another workspace', () => {
        expect(() =>
            buildExplicitAttributionArgs('memory-journal-mcp', { projectRegistry: registry }, 16)
        ).toThrow(ValidationError)
    })

    it('keeps an unknown prompt workspace instead of substituting default', () => {
        expect(resolvePromptPriorWorkspace({ projectRegistry: registry }, 'not-a-repo')).toBe('not-a-repo')
        // [C8 pass 20] An unmatched numeric id is never echoed back as a literal workspace name.
        expect(resolvePromptPriorWorkspace({ projectRegistry: registry }, '#99')).not.toBe('#99')
    })

    it('returns the default workspace from agent-context/default', () => {
        const result = getAgentContextResource().handler('memory://agent-context/default', {
            briefingConfig: { defaultProjectNumber: 5, projectRegistry: registry },
        } as never)
        expect(result.data).toContain('Workspace ID: default')
        expect(result.data).toContain('Project Number: unresolved')
    })

    it('copies INSERT and SELECT SQL scope literals into the recovered call', () => {
        const inserted = extractAndRecoverPreparedStatementCode(
            `db.prepare("INSERT INTO memory_journal (content, workspace_id, project_number) VALUES (?, 'adamic', 16)").run("hello")`
        )
        expect(inserted).toContain('"workspace_id":"adamic"')
        expect(inserted).toContain('"project_number":16')

        const selected = extractAndRecoverPreparedStatementCode(
            `db.prepare("SELECT * FROM memory_journal WHERE id = 4 AND workspace_id = 'adamic' AND project_number = 16").get()`
        )
        expect(selected).toContain('"workspace_id":"adamic"')
        expect(selected).toContain('"project_number":16')
    })

    it('does not expose a dead list action from the prepared-statement shim', async () => {
        const calls: string[] = []
        const shim = createPreparedStatementShim(
            "SELECT * FROM memory_journal WHERE id = 1 AND workspace_id = 'adamic'",
            {
                core: {
                    getEntryById: (params: unknown) => {
                        calls.push('get')
                        return params
                    },
                    getRecentEntries: () => {
                        calls.push('list')
                        return { entries: [] }
                    },
                },
            }
        )
        const get = shim['get']
        expect(typeof get).toBe('function')
        if (typeof get === 'function') await get()
        expect(calls).toEqual(['get'])
    })

    it('resolves a string project_number before filling the workspace registry number', async () => {
        const tool = {
            name: 'create_entry',
            inputSchema: { properties: { project_number: {}, workspace_id: {}, content: {} } },
            annotations: { readOnlyHint: false },
            handler: async (params: unknown) => params,
            group: 'core',
        } as ToolDefinition
        const dispatch = createSecureDispatcher({
            tools: [tool],
            sessionContext: { config: { projectRegistry: registry } } as ToolContext,
            projectId: undefined,
            workspaceId: undefined,
            autoVersion: false,
            dryRun: false,
        })

        const matched = (await dispatch(
            'create_entry',
            { workspace_id: 'memory-journal-mcp', project_number: 'memory-journal-mcp', content: 'note' },
            true
        )) as { params: { project_number: number } }
        expect(matched.params.project_number).toBe(5)

        await expect(
            dispatch(
                'create_entry',
                { workspace_id: 'memory-journal-mcp', project_number: 'adamic', content: 'note' },
                true
            )
        ).rejects.toThrow(ValidationError)
    })
})
