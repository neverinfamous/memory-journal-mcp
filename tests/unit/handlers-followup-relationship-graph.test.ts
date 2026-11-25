import { describe, it, expect } from 'vitest'
import { buildRelationshipGraph } from '../../src/handlers/tools/team/relationship-tools.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'

interface FakeEntry {
    id: number
    content: string
    workspaceId?: string
}
interface FakeRel {
    fromEntryId: number
    toEntryId: number
    relationshipType: string
}

function makeTeamDb(entries: FakeEntry[], rels: FakeRel[]): IDatabaseAdapter {
    const fake = {
        getEntryById: (id: number) => entries.find((e) => e.id === id) ?? null,
        getRelationships: (id: number) =>
            rels.filter((r) => r.fromEntryId === id || r.toEntryId === id),
    }
    return fake as unknown as IDatabaseAdapter
}

describe('buildRelationshipGraph workspace scoping', () => {
    const entries: FakeEntry[] = [
        { id: 1, content: 'one', workspaceId: 'ws-a' },
        { id: 2, content: 'two', workspaceId: 'ws-a' },
        { id: 3, content: 'three', workspaceId: 'ws-b' },
    ]
    const rels: FakeRel[] = [
        { fromEntryId: 1, toEntryId: 2, relationshipType: 'references' },
        { fromEntryId: 2, toEntryId: 3, relationshipType: 'references' },
    ]

    it('drops edges whose endpoint belongs to another workspace', () => {
        const { nodes, edges } = buildRelationshipGraph(makeTeamDb(entries, rels), [1, 2, 3], 'ws-a')
        expect([...nodes.keys()].sort()).toEqual([1, 2])
        expect(edges).toEqual([{ from: 1, to: 2, type: 'references' }])
    })

    it('keeps edges between in-workspace nodes', () => {
        const { nodes, edges } = buildRelationshipGraph(makeTeamDb(entries, rels), [1, 2], 'ws-a')
        expect(nodes.size).toBe(2)
        expect(edges).toHaveLength(1)
    })
})
