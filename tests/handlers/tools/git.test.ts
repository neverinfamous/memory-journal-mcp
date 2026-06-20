import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getGitTools } from '../../../src/handlers/tools/git.js'
import type { ToolContext } from '../../../src/types/index.js'
import { GitHistoryClient } from '../../../src/git/index.js'

vi.mock('../../../src/git/index.js', () => {
    return {
        GitHistoryClient: vi.fn().mockImplementation(function() {
            return {
                getCommitHistory: vi.fn(),
                searchCommits: vi.fn(),
                getReleaseInfo: vi.fn(),
                getUnreleasedChangelog: vi.fn(),
            }
        }),
        CommitAnalyzer: vi.fn().mockImplementation(function() {
            return {
                analyze: vi.fn().mockReturnValue([{ hash: '123', type: 'feat' }])
            }
        })
    }
})

describe('Git Tool Handlers', () => {
    let mockGitClient: any
    let mockContext: ToolContext

    beforeEach(() => {
        vi.clearAllMocks()
        mockGitClient = new GitHistoryClient()
        mockContext = {
            db: {} as any,
            gitClient: mockGitClient,
            progress: { token: '123', onProgress: vi.fn() }
        }
    })

    it('should retrieve commit history', async () => {
        mockGitClient.getCommitHistory.mockResolvedValue([{ hash: '123' }])
        const tools = getGitTools(mockContext)
        const getCommitHistoryTool = tools.find(t => t.name === 'get_commit_history')
        expect(getCommitHistoryTool).toBeDefined()

        const result = await getCommitHistoryTool!.handler({ maxCount: 10 }) as any
        expect(result.success).toBe(true)
        expect(result.commits).toEqual([{ hash: '123' }])
        expect(mockGitClient.getCommitHistory).toHaveBeenCalledWith({ maxCount: 10 })
    })

    it('should search commits', async () => {
        mockGitClient.searchCommits.mockResolvedValue([{ hash: '123' }])
        const tools = getGitTools(mockContext)
        const searchCommitsTool = tools.find(t => t.name === 'search_commits')
        expect(searchCommitsTool).toBeDefined()

        const result = await searchCommitsTool!.handler({ query: 'test' }) as any
        expect(result.success).toBe(true)
        expect(result.commits).toEqual([{ hash: '123' }])
        expect(mockGitClient.searchCommits).toHaveBeenCalledWith('test', { query: 'test' })
    })

    it('should get release info', async () => {
        mockGitClient.getReleaseInfo.mockResolvedValue([{ hash: '123' }])
        const tools = getGitTools(mockContext)
        const getReleaseInfoTool = tools.find(t => t.name === 'get_release_info')
        expect(getReleaseInfoTool).toBeDefined()

        const result = await getReleaseInfoTool!.handler({ ref: 'main' }) as any
        expect(result.success).toBe(true)
        expect(result.commits).toEqual([{ hash: '123' }])
        expect(mockGitClient.getReleaseInfo).toHaveBeenCalledWith({ ref: 'main' })
    })

    it('should get unreleased commits', async () => {
        mockGitClient.getUnreleasedChangelog.mockResolvedValue({ totalCount: 1, categories: { feat: [{ hash: '123' }] } })
        const tools = getGitTools(mockContext)
        const getUnreleasedCommitsTool = tools.find(t => t.name === 'get_unreleased_commits')
        expect(getUnreleasedCommitsTool).toBeDefined()

        const result = await getUnreleasedCommitsTool!.handler({}) as any
        expect(result.success).toBe(true)
        expect(result.changelog).toEqual({ totalCount: 1, categories: { feat: [{ hash: '123' }] } })
        expect(mockGitClient.getUnreleasedChangelog).toHaveBeenCalled()
    })

    it('should analyze commit patterns', async () => {
        mockGitClient.getCommitHistory.mockResolvedValue([{ hash: '123', body: 'feat: new' }])
        const tools = getGitTools(mockContext)
        const analyzeCommitPatternsTool = tools.find(t => t.name === 'analyze_commit_patterns')
        expect(analyzeCommitPatternsTool).toBeDefined()

        const result = await analyzeCommitPatternsTool!.handler({ maxCount: 10 }) as any
        expect(result.success).toBe(true)
        expect(result.analysis).toBeDefined()
        expect(mockGitClient.getCommitHistory).toHaveBeenCalledWith({ maxCount: 10 })
    })
})
