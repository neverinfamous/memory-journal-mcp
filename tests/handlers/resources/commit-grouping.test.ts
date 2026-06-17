import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getTemplateResourceDefinitions } from '../../../src/handlers/resources/templates.js'

vi.mock('../../../src/github/commit-references/index.js', () => ({
    enrichCommits: vi.fn().mockResolvedValue([
        {
            hash: '123',
            subject: 'Add feature',
            authorName: 'Chris',
            date: '2023-01-01',
            references: [
                { type: 'issue', number: 10, title: 'Issue 10' },
                { type: 'pull_request', number: 20, title: 'PR 20' },
            ],
        },
    ]),
}))

describe('Commit Grouping Resources', () => {
    let context: any

    beforeEach(() => {
        vi.clearAllMocks()
        context = {
            db: {
                searchEntries: vi.fn().mockReturnValue({
                    entries: [
                        {
                            id: 'entry-1',
                            tags: ['session-summary'],
                            autoContext: JSON.stringify({
                                commits: ['123'],
                            }),
                        },
                    ],
                }),
            },
            runtime: { cwd: '/test/cwd' },
            github: {},
        }
    })

    it('memory://commits/{project_number} returns enriched commits', async () => {
        const templates = getTemplateResourceDefinitions()
        const handlerDef = templates.find((t) => t.uri === 'memory://commits/{project_number}')

        expect(handlerDef).toBeDefined()
        const result: any = await handlerDef!.handler('memory://commits/1', context)

        expect(result.commits).toEqual(['123'])
        expect(result.enrichedCommits).toHaveLength(1)
        expect(result.enrichedCommits[0].hash).toBe('123')
    })

    it('memory://commits/{project_number}/by-issue groups by issue', async () => {
        const templates = getTemplateResourceDefinitions()
        const handlerDef = templates.find(
            (t) => t.uri === 'memory://commits/{project_number}/by-issue'
        )

        expect(handlerDef).toBeDefined()
        const result: any = await handlerDef!.handler('memory://commits/1/by-issue', context)

        expect(result.issues).toHaveLength(1)
        expect(result.issues[0].number).toBe(10)
        expect(result.issues[0].commits[0].hash).toBe('123')
    })

    it('memory://commits/{project_number}/by-pr groups by PR', async () => {
        const templates = getTemplateResourceDefinitions()
        const handlerDef = templates.find(
            (t) => t.uri === 'memory://commits/{project_number}/by-pr'
        )

        expect(handlerDef).toBeDefined()
        const result: any = await handlerDef!.handler('memory://commits/1/by-pr', context)

        expect(result.pullRequests).toHaveLength(1)
        expect(result.pullRequests[0].number).toBe(20)
        expect(result.pullRequests[0].commits[0].hash).toBe('123')
    })
})
