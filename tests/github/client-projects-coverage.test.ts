import { describe, it, expect, vi } from 'vitest'
import { ProjectsManager } from '../../src/github/github-integration/projects.js'
import type { GitHubClient } from '../../src/github/github-integration/client.js'

describe('ProjectsManager - additional coverage', () => {
    it('deleteProjectItem returns error when graphql is not available', async () => {
        const mockClient = { graphqlWithAuth: null } as unknown as GitHubClient
        const manager = new ProjectsManager(mockClient)
        const result = await manager.deleteProjectItem('proj1', 'item1')
        expect(result.success).toBe(false)
    })

    it('deleteProjectItem handles successful deletion', async () => {
        const graphqlWithAuth = vi.fn().mockResolvedValue({ deleteProjectV2Item: { deletedItemId: 'item1' } })
        const mockClient = { graphqlWithAuth, invalidateCache: vi.fn() } as unknown as GitHubClient
        const manager = new ProjectsManager(mockClient)
        const result = await manager.deleteProjectItem('proj1', 'item1')
        expect(result.success).toBe(true)
        expect(graphqlWithAuth).toHaveBeenCalled()
        expect(mockClient.invalidateCache).toHaveBeenCalledWith('kanban:')
    })

    it('deleteProjectItem handles errors', async () => {
        const graphqlWithAuth = vi.fn().mockRejectedValue(new Error('API Error'))
        const mockClient = { graphqlWithAuth, invalidateCache: vi.fn() } as unknown as GitHubClient
        const manager = new ProjectsManager(mockClient)
        const result = await manager.deleteProjectItem('proj1', 'item1')
        expect(result.success).toBe(false)
        expect(result.error).toBe('API Error')
        expect(mockClient.invalidateCache).toHaveBeenCalledWith('kanban:')
    })

    it('addProjectItem returns error when graphql is not available', async () => {
        const mockClient = { graphqlWithAuth: null } as unknown as GitHubClient
        const manager = new ProjectsManager(mockClient)
        const result = await manager.addProjectItem('proj1', 'content1')
        expect(result.success).toBe(false)
    })

    it('addProjectItem handles successful addition', async () => {
        const graphqlWithAuth = vi.fn().mockResolvedValue({ addProjectV2ItemById: { item: { id: 'newItem' } } })
        const mockClient = { graphqlWithAuth, invalidateCache: vi.fn() } as unknown as GitHubClient
        const manager = new ProjectsManager(mockClient)
        const result = await manager.addProjectItem('proj1', 'content1')
        expect(result.success).toBe(true)
        expect(result.itemId).toBe('newItem')
        expect(mockClient.invalidateCache).toHaveBeenCalledWith('kanban:')
    })

    it('addProjectItem handles errors', async () => {
        const graphqlWithAuth = vi.fn().mockRejectedValue(new Error('API Error'))
        const mockClient = { graphqlWithAuth, invalidateCache: vi.fn() } as unknown as GitHubClient
        const manager = new ProjectsManager(mockClient)
        const result = await manager.addProjectItem('proj1', 'content1')
        expect(result.success).toBe(false)
        expect(mockClient.invalidateCache).toHaveBeenCalledWith('kanban:')
    })
})
