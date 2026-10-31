import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SubscriptionManager } from '../../src/server/subscription-manager.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

describe('SubscriptionManager', () => {
    let manager: SubscriptionManager
    let mockMcpInstance: McpServer
    let mockMcpServer: Server
    const mockSessionId = 'session-123'
    const mockSessionId2 = 'session-456'

    beforeEach(() => {
        manager = new SubscriptionManager()
        
        mockMcpServer = {
            sendResourceUpdated: vi.fn().mockResolvedValue(undefined),
            notification: vi.fn().mockResolvedValue(undefined),
        } as unknown as Server

        mockMcpInstance = {
            server: mockMcpServer
        } as McpServer
    })

    it('registers and unregisters servers correctly', () => {
        manager.registerServer(mockSessionId, mockMcpInstance)
        expect(manager['servers'].has(mockSessionId)).toBe(true)

        manager.unregisterServer(mockSessionId)
        expect(manager['servers'].has(mockSessionId)).toBe(false)
    })

    it('tracks resource subscriptions correctly', () => {
        manager.registerServer(mockSessionId, mockMcpInstance)
        
        manager.subscribe('memory://team/recent', mockSessionId)
        expect(manager['subscriptions'].get('memory://team/recent')?.has(mockSessionId)).toBe(true)

        manager.unsubscribe('memory://team/recent', mockSessionId)
        expect(manager['subscriptions'].has('memory://team/recent')).toBe(false)
    })

    it('sends notifications to subscribed sessions', async () => {
        manager.registerServer(mockSessionId, mockMcpInstance)
        manager.subscribe('memory://team/recent', mockSessionId)

        await manager.notifyResourceUpdated('memory://team/recent')

        expect(mockMcpServer.sendResourceUpdated).toHaveBeenCalledWith({
            uri: 'memory://team/recent'
        })
    })

    it('does not send notifications to unsubscribed sessions', async () => {
        manager.registerServer(mockSessionId, mockMcpInstance)
        // No subscription
        
        await manager.notifyResourceUpdated('memory://team/recent')

        expect(mockMcpServer.sendResourceUpdated).not.toHaveBeenCalled()
    })

    it('broadcasts resource updates to multiple subscribers concurrently', async () => {
        const mockServer2 = {
            sendResourceUpdated: vi.fn().mockResolvedValue(undefined),
        } as unknown as Server
        const mockInstance2 = { server: mockServer2 } as McpServer

        manager.registerServer(mockSessionId, mockMcpInstance)
        manager.registerServer(mockSessionId2, mockInstance2)
        
        manager.subscribe('memory://flags', mockSessionId)
        manager.subscribe('memory://flags', mockSessionId2)

        await manager.notifyResourceUpdated('memory://flags')

        expect(mockMcpServer.sendResourceUpdated).toHaveBeenCalledWith({
            uri: 'memory://flags'
        })
        expect(mockServer2.sendResourceUpdated).toHaveBeenCalledWith({
            uri: 'memory://flags'
        })
    })

    it('cleans up subscriptions when a session is unregistered', async () => {
        manager.registerServer(mockSessionId, mockMcpInstance)
        manager.subscribe('memory://briefing', mockSessionId)
        
        // Unregister session (simulates disconnect)
        manager.unregisterServer(mockSessionId)
        
        // Ensure subscription mapping is cleared
        expect(manager['subscriptions'].has('memory://briefing')).toBe(false)
        
        // Notifying should no longer call the server
        await manager.notifyResourceUpdated('memory://briefing')
        expect(mockMcpServer.sendResourceUpdated).not.toHaveBeenCalled()
    })

    it('broadcasts generic notifications to all connected clients', async () => {
        const mockServer2 = {
            notification: vi.fn().mockResolvedValue(undefined),
        } as unknown as Server
        const mockInstance2 = { server: mockServer2 } as McpServer

        manager.registerServer(mockSessionId, mockMcpInstance)
        manager.registerServer(mockSessionId2, mockInstance2)

        await manager.broadcastNotification('notifications/tools/list_changed')

        expect(mockMcpServer.notification).toHaveBeenCalledWith({ method: 'notifications/tools/list_changed' })
        expect(mockServer2.notification).toHaveBeenCalledWith({ method: 'notifications/tools/list_changed' })
    })
})
