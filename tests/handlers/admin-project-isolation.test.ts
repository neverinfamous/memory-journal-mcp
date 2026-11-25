import { describe, it, expect, vi } from 'vitest'
import { callTool as rawCallTool } from '../../src/handlers/tools/index.js'
import { projectOwnershipMismatch } from '../../src/handlers/tools/admin/core-tools.js'
import {
    UpdateEntrySchema,
    preprocessBatchCreateEntries,
} from '../../src/handlers/tools/admin/schemas/crud-batch-schemas.js'

type Db = Parameters<typeof rawCallTool>[2]
type Config = Parameters<typeof rawCallTool>[5]

const testConfig = {
    runtime: {
        maintenanceManager: {
            withActiveJob: (fn: () => unknown) => fn(),
            acquireMaintenanceLock: async () => {},
            releaseMaintenanceLock: () => {},
        },
    },
} as unknown as Config

const callTool = (name: string, params: Record<string, unknown>, db: Db): Promise<unknown> =>
    rawCallTool(name, params, db, undefined, undefined, testConfig)

describe('audit pass 20 — admin/relationship project isolation', () => {
    it('projectOwnershipMismatch only flags when a project is requested', () => {
        expect(projectOwnershipMismatch(undefined, 7)).toBe(false)
        expect(projectOwnershipMismatch(5, 5)).toBe(false)
        expect(projectOwnershipMismatch(5, 7)).toBe(true)
        expect(projectOwnershipMismatch(5, undefined)).toBe(true)
    })

    it('delete_entry refuses an entry owned by another project even without workspace "*" (H4)', async () => {
        const deleteEntry = vi.fn().mockReturnValue(true)
        const db = {
            getEntryByIdIncludeDeleted: vi.fn().mockReturnValue({ id: 1, workspaceId: 'alpha', projectNumber: 7, version: 1 }),
            deleteEntry,
        } as unknown as Db
        const res = (await callTool('delete_entry', { entry_id: 1, project_number: 5, workspace_id: 'alpha' }, db)) as Record<string, unknown>
        expect(res['success']).toBe(false)
        expect(res['code']).toBe('RESOURCE_NOT_FOUND')
        expect(deleteEntry).not.toHaveBeenCalled()
    })

    it('restore_entry refuses an entry owned by another project (H4)', async () => {
        const restoreEntry = vi.fn().mockReturnValue(true)
        const db = {
            getEntryByIdIncludeDeleted: vi.fn().mockReturnValue({ id: 2, workspaceId: 'alpha', projectNumber: 7 }),
            restoreEntry,
        } as unknown as Db
        const res = (await callTool('restore_entry', { entry_id: 2, project_number: 5, workspace_id: 'alpha' }, db)) as Record<string, unknown>
        expect(res['success']).toBe(false)
        expect(restoreEntry).not.toHaveBeenCalled()
    })

    it('link_entries refuses to link entries outside the requested project (H4)', async () => {
        const linkEntries = vi.fn()
        const db = {
            getEntryById: vi.fn((id: number) => ({ id, workspaceId: 'alpha', projectNumber: id === 10 ? 5 : 7 })),
            getRelationships: vi.fn().mockReturnValue([]),
            linkEntries,
        } as unknown as Db
        const res = (await callTool('link_entries', { from_entry_id: 10, to_entry_id: 11, workspace_id: 'alpha', project_number: 5 }, db)) as Record<string, unknown>
        expect(res['success']).toBe(false)
        expect(linkEntries).not.toHaveBeenCalled()
    })

    it('update payloads never synthesize content from a bare title (H8)', () => {
        const parsed = UpdateEntrySchema.parse({ entry_id: 3, title: 'New heading', is_archived: false })
        expect(parsed.content).toBeUndefined()
    })

    it('batch root project_number is not paired with an item naming another workspace (C3)', () => {
        const out = preprocessBatchCreateEntries({
            project_number: 5,
            workspace_id: 'alpha',
            entries: [{ content: 'a' }, { content: 'b', workspace_id: 'default' }],
        }) as { entries: Record<string, unknown>[] }
        expect(out.entries[0]?.['project_number']).toBe(5)
        expect(out.entries[1]?.['project_number']).toBeUndefined()
        expect(out.entries[1]?.['workspace_id']).toBe('default')
    })
})
