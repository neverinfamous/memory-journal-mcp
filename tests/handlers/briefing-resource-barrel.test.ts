import { describe, it, expect, vi } from 'vitest'
import {
    dynamicBriefingResource,
} from '../../src/handlers/resources/core/briefing/index.js'
import { GitHubIntegration } from '../../src/github/github-integration/index.js'

vi.mock('../../src/github/github-integration/index.js', () => ({
    GitHubIntegration: vi.fn(),
}))

vi.mock('../../src/handlers/resources/core/briefing/github-section.js', () => ({
    buildGitHubSection: vi.fn().mockResolvedValue({}),
}))

vi.mock('../../src/handlers/resources/core/briefing/context-section.js', () => ({
    buildJournalContext: vi
        .fn()
        .mockReturnValue({
            totalEntries: 0,
            latestEntries: [],
            sessionSummaries: [{ id: 1, type: 'summary', preview: 'test' }],
        }),
    buildTeamContext: vi.fn().mockReturnValue(null),
    buildRulesFileInfo: vi.fn().mockReturnValue(null),
    buildSkillsDirInfo: vi.fn().mockReturnValue(null),
}))

vi.mock('../../src/handlers/resources/core/briefing/user-message.js', () => ({
    formatUserMessage: vi.fn().mockReturnValue(''),
}))

describe('Briefing Resources', () => {
    it('dynamicBriefingResource handles URI extraction', async () => {
        const result = await dynamicBriefingResource.handler('memory://briefing/test-repo', {
            briefingConfig: {
                projectRegistry: {
                    'test-repo': { path: '/tmp/test', project_number: 5 },
                },
            },
        } as any)

        expect(result.data).toBeDefined()
        expect(GitHubIntegration).toHaveBeenCalledWith('/tmp/test')
    })

    it('dynamicBriefingResource handles URI extraction with missing repo in registry', async () => {
        const result = await dynamicBriefingResource.handler('memory://briefing/missing-repo', {
            briefingConfig: {
                projectRegistry: {},
            },
        } as any)

        expect(result.data).toBeDefined()
    })
})
