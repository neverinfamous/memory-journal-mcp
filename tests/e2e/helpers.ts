/**
 * Shared E2E test helpers for payload contract tests.
 *
 * Provides:
 * - createClient() — Streamable HTTP client factory
 * - callToolAndParse() — call tool + parse JSON response
 * - expectSuccess() — assert payload is not a structured error
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { expect } from '@playwright/test'

const BASE_URL = 'http://localhost:3100/mcp'

/**
 * Create and connect a Streamable HTTP MCP client.
 * Caller is responsible for calling client.close() in afterAll.
 */
export async function createClient(): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(new URL(BASE_URL))
    const client = new Client({ name: 'payload-contract-test', version: '1.0.0' }, { capabilities: {} })
    await client.connect(transport)
    return client
}

/**
 * Call a tool and parse the JSON text response into a typed object.
 * Asserts the response has text content and returns the parsed payload.
 */
export async function callToolAndParse(
    client: Client,
    toolName: string,
    args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const response = await client.callTool({ name: toolName, arguments: args })

    expect(response.isError).toBeUndefined()
    expect(Array.isArray(response.content)).toBe(true)

    const content = response.content as Array<{ type: string; text?: string }>
    expect(content.length).toBeGreaterThan(0)

    const first = content[0]!
    expect(first.type).toBe('text')

    return JSON.parse(first.text!) as Record<string, unknown>
}

/**
 * Assert that a parsed payload is NOT a structured error.
 * Throws a descriptive error if the tool returned { success: false, error: "..." }.
 */
export function expectSuccess(payload: Record<string, unknown>): void {
    if (payload.success === false) {
        throw new Error(`Tool returned error: ${JSON.stringify(payload.error)}`)
    }
}
