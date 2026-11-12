import { describe, it, expect, vi } from 'vitest'
import { linkRequestedRelationships } from '../../src/handlers/tools/relationship-linking.js'
import { isPrivateOrLoopbackAddress } from '../../src/utils/network-safety.js'
import { parseToolFilter } from '../../src/filtering/tool-filter.js'
import { buildPriorAuditSection } from '../../src/handlers/prompts/adversarial-helpers.js'
import { resolveProjectNumberFromPath } from '../../src/utils/workspace-resolver.js'

describe('linkRequestedRelationships', () => {
    it('maps aliases to canonical types and reports no warnings on success', () => {
        const linkEntries = vi.fn()
        const warnings = linkRequestedRelationships({ linkEntries }, 7, [
            { targetId: 1, relationType: 'resolves' },
            { targetId: 2, relationType: 'relates_to' },
            { targetId: 3, relationType: 'depends_on' },
        ])
        expect(warnings).toEqual([])
        expect(linkEntries).toHaveBeenNthCalledWith(1, 7, 1, 'resolved')
        expect(linkEntries).toHaveBeenNthCalledWith(2, 7, 2, 'references')
        expect(linkEntries).toHaveBeenNthCalledWith(3, 7, 3, 'blocked_by')
    })

    it('returns a warning for each link that failed instead of dropping it silently', () => {
        const linkEntries = vi.fn().mockImplementation((_from: number, to: number) => {
            if (to === 2) throw new Error('target not found')
        })
        const warnings = linkRequestedRelationships({ linkEntries }, 7, [
            { targetId: 1, relationType: 'references' },
            { targetId: 2, relationType: 'references' },
        ])
        expect(warnings).toHaveLength(1)
        expect(warnings[0]).toContain('#2')
        expect(warnings[0]).toContain('target not found')
    })
})

describe('isPrivateOrLoopbackAddress', () => {
    it.each([
        '127.0.0.1',
        '10.1.2.3',
        '192.168.0.5',
        '172.16.0.1',
        '172.31.255.255',
        '169.254.1.1',
        '::1',
        'fd12:3456::1',
        '::ffff:10.0.0.1',
    ])('blocks %s', (address) => {
        expect(isPrivateOrLoopbackAddress(address)).toBe(true)
    })

    it.each(['8.8.8.8', '172.32.0.1', '2606:4700::1111', 'fcdn.example.com'])(
        'allows %s',
        (address) => {
            expect(isPrivateOrLoopbackAddress(address)).toBe(false)
        }
    )
})

describe('parseToolFilter unknown names', () => {
    it('still enables a valid tool and does not invent a group for a typo', () => {
        const config = parseToolFilter('core,+not_a_real_tool')
        expect(config.enabledTools.has('create_entry')).toBe(true)
        expect(config.enabledTools.has('not_a_real_tool')).toBe(true)
        expect(config.rules.at(-1)?.isGroup).toBe(false)
    })
})

describe('buildPriorAuditSection workspace scoping', () => {
    function makeDb(entriesByWorkspace: Record<string, { id: number }[]>) {
        const lookup = (opts: { workspaceId?: string }) => ({
            entries: (entriesByWorkspace[opts.workspaceId ?? ''] ?? []).map((e) => ({
                id: e.id,
                entryType: 'technical_note',
                content: `audit ${String(e.id)}`,
                timestamp: '2026-01-01T00:00:00.000Z',
            })),
        })
        return {
            searchByDateRange: vi.fn((_s: string, _e: string, opts: { workspaceId?: string }) =>
                lookup(opts)
            ),
            searchEntries: vi.fn((_q: string, opts: { workspaceId?: string }) => lookup(opts)),
        }
    }

    it('queries only the requested workspace when workspace_id is given', () => {
        const db = makeDb({ 'repo-a': [{ id: 11 }], 'other-repo': [{ id: 99 }] })
        const section = buildPriorAuditSection(
            db as never,
            'code-quality-audit',
            'Prior code-quality audits',
            {
                defaultWorkspaceId: 'other-repo',
                projectRegistry: {
                    'repo-a': { path: '/tmp/repo-a', project_number: 1 },
                    'other-repo': { path: '/tmp/other-repo', project_number: 2 },
                },
            },
            'repo-a'
        )
        expect(section).toContain('#11')
        expect(section).not.toContain('#99')
        expect(section).toContain('`repo-a`')
        expect(db.searchByDateRange.mock.calls[0]?.[2]).toMatchObject({ workspaceId: 'repo-a' })
    })

    it('falls back to the default workspace and never uses a wildcard workspace', () => {
        const db = makeDb({ 'other-repo': [{ id: 99 }] })
        const section = buildPriorAuditSection(
            db as never,
            'code-quality-audit',
            'Prior code-quality audits',
            { defaultWorkspaceId: 'other-repo' },
            '*'
        )
        expect(section).toContain('#99')
        expect(db.searchByDateRange.mock.calls[0]?.[2]).toMatchObject({
            workspaceId: 'other-repo',
        })
    })

    it('tells the agent how to rescope when nothing is found', () => {
        const db = makeDb({})
        const section = buildPriorAuditSection(db as never, 'code-quality-audit', 'Heading', undefined)
        expect(section).toContain('workspace_id')
    })
})

describe('resolveProjectNumberFromPath registry override', () => {
    it('resolves against an injected registry even under the test runner', () => {
        const registry = {
            alpha: { path: process.cwd(), project_number: 42 },
        }
        expect(resolveProjectNumberFromPath(process.cwd(), registry)).toBe(42)
    })

    it('still returns undefined without a registry under the test runner', () => {
        expect(resolveProjectNumberFromPath(process.cwd())).toBeUndefined()
    })
})
