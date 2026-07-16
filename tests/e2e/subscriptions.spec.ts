import { test, expect } from './test-fixture.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { startServer, stopServer } from './helpers.js'

const PORT = 3190

test.describe.configure({ mode: 'serial' })

test.describe('E2E MCP Subscriptions', () => {
    let client: Client
    let receivedNotifications: string[] = []

    test.beforeAll(async () => {
        await startServer(PORT, ['--tool-filter', 'core'], 'subscriptions')

        const transport = new SSEClientTransport(new URL(`http://localhost:${PORT}/sse`))
        client = new Client(
            { name: 'playwright-subscription-test', version: '1.0.0' },
            { capabilities: {} }
        )

        client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
            if (notification.params.uri) {
                receivedNotifications.push(notification.params.uri)
            }
        })

        await client.connect(transport)
    })

    test.afterAll(async () => {
        await client.close()
        stopServer(PORT)
    })

    test.beforeEach(() => {
        receivedNotifications = []
    })

    test('should successfully subscribe to memory://recent', async () => {
        await client.subscribeResource({ uri: 'memory://recent' })
    })

    test('should fail to subscribe to unsupported uri', async () => {
        await expect(client.subscribeResource({ uri: 'memory://nonexistent' })).rejects.toThrow()
    })

    test('should receive resource update notification on mutation', async () => {
        // Trigger a mutation which should invalidate cache and emit update for subscribed resources
        await client.callTool({
            name: 'create_entry',
            arguments: {
                workspace_id: 'default',
                project_number: 1,
                content: 'test subscription entry'
            },
        })

        await new Promise((resolve) => setTimeout(resolve, 500))

        expect(receivedNotifications).toContain('memory://recent')
    })

    test('should successfully unsubscribe from memory://recent', async () => {
        await client.unsubscribeResource({ uri: 'memory://recent' })
        receivedNotifications = []

        await client.callTool({
            name: 'create_entry',
            arguments: {
                workspace_id: 'default',
                project_number: 1,
                content: 'test another entry'
            },
        })

        await new Promise((resolve) => setTimeout(resolve, 500))

        expect(receivedNotifications).not.toContain('memory://recent')
    })
})
