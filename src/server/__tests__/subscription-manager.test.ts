import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SubscriptionManager } from '../subscription-manager.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { McpServerInstance } from '../mcp-server.js'

describe('SubscriptionManager', () => {
    let manager: SubscriptionManager
    let mockMcpInstance: McpServerInstance
    let mockMcpServer: Server
    const mockSessionId = 'session-123'
    const mockSessionId2 = 'session-456'

    beforeEach(() => {
        manager = new SubscriptionManager()
        
        mockMcpServer = {
            sendNotification: vi.fn().mockResolvedValue(undefined),
        } as unknown as Server

        mockMcpInstance = {
            server: mockMcpServer
        } as McpServerInstance
    })

    it('registers and unregisters sessions correctly', () => {
        manager.registerSession(mockSessionId, mockMcpInstance)
        expect(manager['sessions'].has(mockSessionId)).toBe(true)

        manager.unregisterSession(mockSessionId)
        expect(manager['sessions'].has(mockSessionId)).toBe(false)
    })

    it('tracks resource subscriptions correctly', () => {
        manager.registerSession(mockSessionId, mockMcpInstance)
        
        manager.subscribe(mockSessionId, 'memory://team/recent')
        expect(manager['subscriptions'].get('memory://team/recent')?.has(mockSessionId)).toBe(true)

        manager.unsubscribe(mockSessionId, 'memory://team/recent')
        expect(manager['subscriptions'].get('memory://team/recent')?.has(mockSessionId)).toBe(false)
    })

    it('sends notifications to subscribed sessions', async () => {
        manager.registerSession(mockSessionId, mockMcpInstance)
        manager.subscribe(mockSessionId, 'memory://team/recent')

        await manager.notifyResourceUpdated('memory://team/recent')

        expect(mockMcpServer.sendNotification).toHaveBeenCalledWith('notifications/resources/list_changed')
        expect(mockMcpServer.sendNotification).toHaveBeenCalledWith('notifications/resources/updated', {
            uri: 'memory://team/recent'
        })
    })

    it('does not send notifications to unsubscribed sessions', async () => {
        manager.registerSession(mockSessionId, mockMcpInstance)
        // No subscription
        
        await manager.notifyResourceUpdated('memory://team/recent')

        expect(mockMcpServer.sendNotification).not.toHaveBeenCalled()
    })

    it('broadcasts notifications to multiple subscribers concurrently', async () => {
        const mockServer2 = {
            sendNotification: vi.fn().mockResolvedValue(undefined),
        } as unknown as Server
        const mockInstance2 = { server: mockServer2 } as McpServerInstance

        manager.registerSession(mockSessionId, mockMcpInstance)
        manager.registerSession(mockSessionId2, mockInstance2)
        
        manager.subscribe(mockSessionId, 'memory://flags')
        manager.subscribe(mockSessionId2, 'memory://flags')

        await manager.notifyResourceUpdated('memory://flags')

        expect(mockMcpServer.sendNotification).toHaveBeenCalledWith('notifications/resources/updated', {
            uri: 'memory://flags'
        })
        expect(mockServer2.sendNotification).toHaveBeenCalledWith('notifications/resources/updated', {
            uri: 'memory://flags'
        })
    })

    it('cleans up subscriptions when a session is unregistered', async () => {
        manager.registerSession(mockSessionId, mockMcpInstance)
        manager.subscribe(mockSessionId, 'memory://briefing')
        
        // Unregister session (simulates disconnect)
        manager.unregisterSession(mockSessionId)
        
        // Ensure subscription mapping is cleared
        expect(manager['subscriptions'].get('memory://briefing')?.has(mockSessionId)).toBe(false)
        
        // Notifying should no longer call the server
        await manager.notifyResourceUpdated('memory://briefing')
        expect(mockMcpServer.sendNotification).not.toHaveBeenCalled()
    })
})
