/**
 * Shared E2E test helpers for payload contract tests.
 *
 * Provides:
 * - createClient() — Streamable HTTP client factory
 * - callToolAndParse() — call tool + parse JSON response
 * - callToolRaw() — call tool + return raw MCP response (no JSON parsing)
 * - expectSuccess() — assert payload is not a structured error
 * - expectHandlerError() — assert payload IS a structured handler error
 * - getBaseURL() — resolve base URL from Playwright testInfo
 * - startServer() / stopServer() — managed child-process server lifecycle
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { TestInfo } from '@playwright/test'
import { expect } from '@playwright/test'
import { type ChildProcess, spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { join } from 'node:path'

const DEFAULT_PORT = 3100

// ─── Base URL resolution ────────────────────────────────────────────────────

/**
 * Resolve the base URL from Playwright test info.
 * Falls back to http://localhost:3100 if not set in project config.
 */
export function getBaseURL(testInfo: TestInfo): string {
    return (
        (testInfo.project.use as { baseURL?: string }).baseURL ??
        `http://localhost:${DEFAULT_PORT}`
    )
}

/**
 * Create and connect a Streamable HTTP MCP client.
 * Caller is responsible for calling client.close() in afterAll.
 */
export async function createClient(port = 3100): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`))
    const client = new Client(
        { name: 'payload-contract-test', version: '1.0.0' },
        { capabilities: {} }
    )
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
    args: Record<string, unknown>
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

// ─── Raw tool call ──────────────────────────────────────────────────────────

/**
 * Call a tool and return the raw MCP response (without JSON parsing).
 * Useful for inspecting isError, checking raw text, or handling non-JSON.
 */
export async function callToolRaw(
    client: Client,
    toolName: string,
    args: Record<string, unknown>
): Promise<{
    content: Array<{ type: string; text: string }>
    isError?: boolean
}> {
    const response = await client.callTool({ name: toolName, arguments: args })
    return response as {
        content: Array<{ type: string; text: string }>
        isError?: boolean
    }
}

// ─── Error assertion ────────────────────────────────────────────────────────

/**
 * Assert that a payload IS a structured handler error.
 * Checks for `{ success: false, error: "..." }` shape.
 */
export function expectHandlerError(
    payload: Record<string, unknown>,
    expectedMessage?: string | RegExp
): void {
    expect(payload.success, `Expected handler error, got: ${JSON.stringify(payload)}`).toBe(false)
    expect(typeof payload.error, `Missing error string in: ${JSON.stringify(payload)}`).toBe(
        'string'
    )

    if (expectedMessage instanceof RegExp) {
        expect(payload.error as string).toMatch(expectedMessage)
    } else if (typeof expectedMessage === 'string') {
        expect((payload.error as string).toLowerCase()).toContain(expectedMessage.toLowerCase())
    }
}

// =============================================================================
// Server Process Management
// =============================================================================

interface ManagedServer {
    process: ChildProcess
    port: number
}

const managedServers = new Map<number, ManagedServer>()

/**
 * Start an MCP server as a child process with custom CLI args.
 * Waits for /health to become reachable before returning.
 *
 * @param port - Port to start the server on
 * @param args - Additional CLI args (e.g., ['--stateless', '--auth-token', 'secret'])
 * @param dbSuffix - Database file suffix to avoid collisions (default: port number)
 */
export async function startServer(
    port: number,
    args: string[] = [],
    dbSuffix?: string,
    options?: { cwd?: string }
): Promise<void> {
    const suffix = dbSuffix ?? String(port)
    const serverProcess = spawn(
        'node',
        [
            join(process.cwd(), 'dist/cli.js'),
            '--transport',
            'http',
            '--port',
            String(port),
            '--db',
            join(process.cwd(), '.test-output', 'e2e', `test-e2e-${suffix}.db`),
            ...args,
        ],
        {
            cwd: options?.cwd ?? process.cwd(),
            stdio: 'pipe',
            env: {
                ...process.env,
                MCP_RATE_LIMIT_MAX: args.some((a) => a === '--rate-limit-max')
                    ? undefined
                    : '10000',
            },
        }
    )

    managedServers.set(port, { process: serverProcess, port })

    const maxAttempts = 30
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const res = await fetch(`http://localhost:${port}/health`)
            if (res.ok) return
        } catch {
            // Server not ready yet
        }
        await delay(500)
    }
    throw new Error(`Server on port ${port} did not start within timeout`)
}

/**
 * Stop a managed server by port number.
 */
export function stopServer(port: number): void {
    const server = managedServers.get(port)
    if (server) {
        server.process.kill('SIGTERM')
        managedServers.delete(port)
    }
}
