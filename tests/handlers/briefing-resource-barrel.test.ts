import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/github/github-integration/index.js', () => ({
    GitHubIntegration: vi.fn(),
    getGitHubIntegration: vi.fn().mockImplementation(() => new (vi.mocked(GitHubIntegration))()),
}))

vi.mock('../../src/handlers/resources/core/briefing/github-section.js', () => ({
    buildGitHubSection: vi.fn().mockResolvedValue({}),
}))

import { dynamicBriefingResource } from '../../src/handlers/resources/core/briefing/index.js'
import {
    GitHubIntegration,
    getGitHubIntegration,
} from '../../src/github/github-integration/index.js'

vi.mock('../../src/handlers/resources/core/briefing/context-section.js', () => ({
    buildJournalContext: vi.fn().mockReturnValue({
        totalEntries: 0,
        latestEntries: [],
        sessionSummaries: [{ id: 1, type: 'summary', preview: 'test' }],
    }),
    buildTeamContext: vi.fn().mockReturnValue(null),
    buildRulesFileInfo: vi.fn().mockReturnValue(null),
    buildSkillsDirInfo: vi.fn().mockReturnValue(null),
    buildFlagsContext: vi.fn().mockReturnValue(undefined),
}))

vi.mock('../../src/handlers/resources/core/briefing/user-message.js', () => ({
    formatUserMessage: vi.fn().mockReturnValue(''),
}))

describe('Briefing Resources', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('dynamicBriefingResource handles URI extraction', async () => {
        const result = await dynamicBriefingResource.handler('memory://briefing/test-repo', {
            runtime: { type: 'stdio' },
            briefingConfig: {
                projectRegistry: {
                    'test-repo': { path: '/tmp/test', project_number: 5 },
                },
            },
        } as any)

        expect((result as any).data).toBeDefined()
        expect(getGitHubIntegration).toHaveBeenCalledTimes(1)
        expect(getGitHubIntegration).toHaveBeenCalledWith('/tmp/test', { type: 'stdio' })
    })

    it('dynamicBriefingResource handles URI extraction with missing repo in registry', async () => {
        const result = await dynamicBriefingResource.handler('memory://briefing/missing-repo', {
            briefingConfig: {
                projectRegistry: {},
            },
        } as any)

        expect((result as any).data).toBeDefined()
    })
})
