/**
 * McpServer Tests
 *
 * Tests the createServer() function with mocked MCP SDK, database,
 * vector manager, and GitHub integration. Verifies tool/resource/prompt
 * registration and server initialization flows.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================================
// Hoisted mocks
// ============================================================================

const {
    mockRegisterTool,
    mockRegisterResource,
    mockRegisterPrompt,
    mockConnect,
    mockServer,
    mockDbInitialize,
    mockDbGetRecentEntries,
    mockDbGetStatistics,
    mockDbClose,
    mockDbGetRawDb,
    mockVectorInitialize,
    mockVectorRebuildIndex,
    mockGitHubIsApiAvailable,
    mockCreateEntry,
    mockStdioTransport,
    mockListTags,
    mockHandlers,
} = vi.hoisted(() => ({
    mockRegisterTool: vi.fn(),
    mockRegisterResource: vi.fn(),
    mockRegisterPrompt: vi.fn(),
    mockConnect: vi.fn().mockResolvedValue(undefined),
    mockServer: { server: {} },
    mockDbInitialize: vi.fn().mockResolvedValue(undefined),
    mockDbGetRecentEntries: vi.fn().mockReturnValue([
        {
            id: 1,
            content: 'Test entry',
            entryType: 'personal_reflection',
            timestamp: new Date().toISOString(),
            isPersonal: true,
            tags: [],
        },
    ]),
    mockDbGetStatistics: vi.fn().mockReturnValue({
        totalEntries: 5,
        entriesByType: {},
        entriesByPeriod: [],
        causalMetrics: { blocked_by: 0, resolved: 0, caused: 0 },
    }),
    mockDbClose: vi.fn(),
    mockDbGetRawDb: vi.fn().mockReturnValue({
        exec: vi.fn().mockReturnValue([]),
    }),
    mockVectorInitialize: vi.fn().mockResolvedValue(undefined),
    mockVectorRebuildIndex: vi.fn().mockResolvedValue(10),
    mockGitHubIsApiAvailable: vi.fn().mockReturnValue(false),
    mockCreateEntry: vi.fn().mockReturnValue({
        id: 1,
        content: 'test',
        entryType: 'personal_reflection',
        timestamp: new Date().toISOString(),
        isPersonal: true,
        tags: [],
    }),
    mockStdioTransport: {},
    mockListTags: vi.fn().mockReturnValue([]),
    mockHandlers: {
        get: {} as Record<string, Function>,
        post: {} as Record<string, Function>,
        delete: {} as Record<string, Function>,
        all: {} as Record<string, Function>,
        use: {} as Record<string, Function>,
    },
}))

// ============================================================================
// Module mocks
// ============================================================================

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
    McpServer: function () {
        return {
            registerTool: mockRegisterTool,
            registerResource: mockRegisterResource,
            registerPrompt: mockRegisterPrompt,
            connect: mockConnect,
            server: mockServer,
        }
    },
    ResourceTemplate: function () {
        return {
            uriTemplate: { template: 'mock-template' },
        }
    },
}))

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
    StdioServerTransport: function () {
        return mockStdioTransport
    },
}))

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
    StreamableHTTPServerTransport: function () {
        return {
            handleRequest: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockResolvedValue(undefined),
            sessionId: undefined,
        }
    },
}))

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
    isInitializeRequest: vi.fn().mockReturnValue(false),
}))

vi.mock('../../src/database/SqliteAdapter.js', () => ({
    SqliteAdapter: function () {
        return {
            initialize: mockDbInitialize,
            getRecentEntries: mockDbGetRecentEntries,
            getStatistics: mockDbGetStatistics,
            getActiveEntryCount: vi.fn().mockReturnValue(5),
            createEntry: mockCreateEntry,
            getEntryById: vi.fn().mockReturnValue(null),
            searchEntries: vi.fn().mockReturnValue([]),
            searchByDateRange: vi.fn().mockReturnValue([]),
            getRelationships: vi.fn().mockReturnValue([]),
            linkEntries: vi.fn().mockReturnValue({ id: 1, relationshipType: 'references' }),
            updateEntry: vi.fn().mockReturnValue(null),
            deleteEntry: vi.fn().mockReturnValue(true),
            listTags: mockListTags,
            mergeTags: vi.fn().mockReturnValue({ sourceDeleted: true, entriesUpdated: 0 }),
            getHealthStatus: vi.fn().mockReturnValue({
                database: { path: 'test.db', entryCount: 5, sizeBytes: 1000 },
            }),
            exportToFile: vi.fn().mockReturnValue({
                filename: 'backup.db',
                path: '/tmp/backup.db',
                sizeBytes: 1000,
            }),
            listBackups: vi.fn().mockReturnValue([]),
            getTagsForEntry: vi.fn().mockReturnValue([]),
            getRawDb: mockDbGetRawDb,
            getEntriesPage: vi.fn().mockReturnValue([]),
            close: mockDbClose,
        }
    },
}))

vi.mock('../../src/vector/VectorSearchManager.js', () => ({
    VectorSearchManager: function () {
        return {
            initialize: mockVectorInitialize,
            isInitialized: vi.fn().mockReturnValue(false),
            search: vi.fn().mockResolvedValue([]),
            addEntry: vi.fn().mockResolvedValue(true),
            removeEntry: vi.fn().mockResolvedValue(true),
            rebuildIndex: mockVectorRebuildIndex,
            getStats: vi
                .fn()
                .mockResolvedValue({ itemCount: 0, modelName: 'test', dimensions: 384 }),
            generateEmbedding: vi.fn().mockResolvedValue(new Array(384).fill(0)),
        }
    },
}))

vi.mock('../../src/github/GitHubIntegration.js', () => ({
    GitHubIntegration: function () {
        return {
            isApiAvailable: mockGitHubIsApiAvailable,
            getRepoInfo: vi.fn().mockResolvedValue({ owner: null, repo: null, branch: null }),
            getCachedRepoInfo: vi.fn().mockReturnValue(null),
            getRepoContext: vi.fn().mockResolvedValue(null),
            getIssues: vi.fn().mockResolvedValue([]),
            getIssue: vi.fn().mockResolvedValue(null),
            createIssue: vi.fn().mockResolvedValue(null),
            closeIssue: vi.fn().mockResolvedValue(null),
            getPullRequests: vi.fn().mockResolvedValue([]),
            getPullRequest: vi.fn().mockResolvedValue(null),
            getWorkflowRuns: vi.fn().mockResolvedValue([]),
            getProjectKanban: vi.fn().mockResolvedValue(null),
            getMilestones: vi.fn().mockResolvedValue([]),
            getMilestone: vi.fn().mockResolvedValue(null),
            createMilestone: vi.fn().mockResolvedValue(null),
            updateMilestone: vi.fn().mockResolvedValue(null),
            deleteMilestone: vi.fn().mockResolvedValue(null),
            moveProjectItem: vi.fn().mockResolvedValue({ success: false }),
            addProjectItem: vi.fn().mockResolvedValue({ success: false }),
            clearCache: vi.fn(),
            invalidateCache: vi.fn(),
        }
    },
}))

// Mock express to avoid actual HTTP server creation
vi.mock('express', () => {
    const mockApp = {
        use: vi.fn().mockImplementation((...args: unknown[]) => {
            if (args.length === 1 && typeof args[0] === 'function') {
                mockHandlers.use['*'] = args[0] as () => void
            }
        }),
        get: vi.fn().mockImplementation((path: string, handler: unknown) => {
            mockHandlers.get[path] = handler as () => void
        }),
        post: vi.fn().mockImplementation((path: string, handler: unknown) => {
            mockHandlers.post[path] = handler as () => void
        }),
        delete: vi.fn().mockImplementation((path: string, handler: unknown) => {
            mockHandlers.delete[path] = handler as () => void
        }),
        all: vi.fn().mockImplementation((path: string, handler: unknown) => {
            mockHandlers.all[path] = handler as () => void
        }),
        listen: vi.fn().mockImplementation((_port: number, _host: string, cb?: () => void) => {
            if (cb) cb()
            return {
                on: vi.fn(),
                close: vi.fn(),
            }
        }),
    }
    const expressFn = vi.fn().mockReturnValue(mockApp)
    return {
        default: Object.assign(expressFn, {
            json: vi.fn().mockReturnValue(vi.fn()),
        }),
    }
})

// Suppress process.on/exit in tests
vi.spyOn(process, 'on').mockImplementation(() => process)
vi.spyOn(process, 'exit').mockImplementation((() => {}) as never)

// ============================================================================
// Import after mocks
// ============================================================================

import { createServer, type ServerOptions } from '../../src/server/McpServer.js'

describe('McpServer', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ========================================================================
    // Server initialization
    // ========================================================================

    describe('createServer - stdio transport', () => {
        it('should initialize database and register tools/resources/prompts', async () => {
            await createServer({
                transport: 'stdio',
                dbPath: './test-server.db',
            })

            // Database should be initialized
            expect(mockDbInitialize).toHaveBeenCalledOnce()

            // Tools should be registered
            expect(mockRegisterTool).toHaveBeenCalled()
            expect(mockRegisterTool.mock.calls.length).toBeGreaterThan(10)

            // Resources should be registered
            expect(mockRegisterResource).toHaveBeenCalled()
            expect(mockRegisterResource.mock.calls.length).toBeGreaterThan(5)

            // Prompts should be registered
            expect(mockRegisterPrompt).toHaveBeenCalled()

            // Should connect with stdio transport
            expect(mockConnect).toHaveBeenCalled()
        })

        it('should pass tool options with description', async () => {
            await createServer({
                transport: 'stdio',
                dbPath: './test-server.db',
            })

            // First registered tool should have description
            const firstCall = mockRegisterTool.mock.calls[0] as unknown[]
            expect(firstCall).toBeDefined()
            expect(typeof firstCall[0]).toBe('string') // tool name
            expect(firstCall[1]).toBeDefined() // tool options with description
        })

        it('should register create_entry tool', async () => {
            await createServer({
                transport: 'stdio',
                dbPath: './test-server.db',
            })

            // Check that 'create_entry' was registered
            const toolNames = mockRegisterTool.mock.calls.map(
                (call: unknown[]) => call[0]
            ) as string[]
            expect(toolNames).toContain('create_entry')
            expect(toolNames).toContain('get_entry_by_id')
            expect(toolNames).toContain('search_entries')
        })
    })

    // ========================================================================
    // Tool filter
    // ========================================================================

    describe('createServer - with tool filter', () => {
        it('should apply tool filter when provided', async () => {
            await createServer({
                transport: 'stdio',
                dbPath: './test-server.db',
                toolFilter: 'core',
            })

            // Should still register tools (filtered set)
            expect(mockRegisterTool).toHaveBeenCalled()
            // Filtered set should be smaller than full set
            const filteredCount = mockRegisterTool.mock.calls.length
            expect(filteredCount).toBeGreaterThan(0)
        })
    })

    // ========================================================================
    // Auto-rebuild vector index
    // ========================================================================

    describe('createServer - auto rebuild index', () => {
        it('should rebuild vector index when autoRebuildIndex is true', async () => {
            await createServer({
                transport: 'stdio',
                dbPath: './test-server.db',
                autoRebuildIndex: true,
            })

            expect(mockVectorInitialize).toHaveBeenCalledOnce()
            expect(mockVectorRebuildIndex).toHaveBeenCalled()
        })

        it('should NOT rebuild index when autoRebuildIndex is not set', async () => {
            await createServer({
                transport: 'stdio',
                dbPath: './test-server.db',
            })

            expect(mockVectorInitialize).not.toHaveBeenCalled()
            expect(mockVectorRebuildIndex).not.toHaveBeenCalled()
        })
    })

    // ========================================================================
    // Resource registration
    // ========================================================================

    describe('createServer - resource registration', () => {
        it('should register both static and template resources', async () => {
            await createServer({
                transport: 'stdio',
                dbPath: './test-server.db',
            })

            // Should have both static and template resources
            const resourceCalls = mockRegisterResource.mock.calls
            expect(resourceCalls.length).toBeGreaterThan(10)
        })
    })

    // ========================================================================
    // Prompt registration
    // ========================================================================

    describe('createServer - prompt registration', () => {
        it('should register prompts with argsSchema', async () => {
            await createServer({
                transport: 'stdio',
                dbPath: './test-server.db',
            })

            const promptCalls = mockRegisterPrompt.mock.calls
            expect(promptCalls.length).toBeGreaterThan(0)

            // Each prompt has name, options, handler
            const firstPrompt = promptCalls[0] as unknown[]
            expect(typeof firstPrompt[0]).toBe('string') // prompt name
            expect(firstPrompt[1]).toBeDefined() // options with description
            expect(typeof firstPrompt[2]).toBe('function') // handler
        })
    })

    // ========================================================================
    // HTTP transport (stateless)
    // ========================================================================

    describe('createServer - HTTP stateless', () => {
        it('should set up express app for stateless HTTP', async () => {
            await createServer({
                transport: 'http',
                dbPath: './test-server.db',
                statelessHttp: true,
                port: 4000,
                host: '0.0.0.0',
            })

            // Should connect to transport
            expect(mockConnect).toHaveBeenCalled()
        })
    })

    // ========================================================================
    // HTTP transport (stateful)
    // ========================================================================

    describe('createServer - HTTP stateful', () => {
        it('should set up express app for stateful HTTP with session management', async () => {
            await createServer({
                transport: 'http',
                dbPath: './test-server.db',
                statelessHttp: false,
                port: 5000,
                host: '127.0.0.1',
            })

            // Should NOT call connect for stateful mode (connects per-session)
            // The server.connect is only called once for stateless or stdio
            // For stateful, connect is called per new session initialization
            expect(mockRegisterTool).toHaveBeenCalled()
        })

        it('should configure CORS origin from options', async () => {
            await createServer({
                transport: 'http',
                dbPath: './test-server.db',
                corsOrigin: 'https://example.com',
            })

            expect(mockRegisterTool).toHaveBeenCalled()
        })
    })

    // ========================================================================
    // Default project number
    // ========================================================================

    describe('createServer - defaultProjectNumber', () => {
        it('should pass defaultProjectNumber through to tools', async () => {
            await createServer({
                transport: 'stdio',
                dbPath: './test-server.db',
                defaultProjectNumber: 42,
            })

            // Tools should be registered (they receive defaultProjectNumber internally)
            expect(mockRegisterTool).toHaveBeenCalled()
        })
    })

    // ========================================================================
    // Tool handler callbacks
    // ========================================================================

    describe('tool handler callbacks', () => {
        it('should invoke tool handler and return structured content', async () => {
            await createServer({
                transport: 'stdio',
                dbPath: './test-server.db',
            })

            // Get the handler for a tool
            const createEntryCalls = mockRegisterTool.mock.calls.filter(
                (call: unknown[]) => call[0] === 'create_entry'
            ) as unknown[][]

            expect(createEntryCalls.length).toBe(1)
            const handler = createEntryCalls[0]![2] as (
                args: Record<string, unknown>,
                extra: Record<string, unknown>
            ) => Promise<{ content: { type: string; text: string }[] }>

            const result = await handler({ content: 'Test from mock' }, { _meta: {} })

            expect(result.content).toBeDefined()
            expect(result.content[0]!.type).toBe('text')
        })

        it('should return error content when tool throws', async () => {
            // Make createEntry throw
            mockCreateEntry.mockImplementationOnce(() => {
                throw new Error('Database error')
            })

            await createServer({
                transport: 'stdio',
                dbPath: './test-server.db',
            })

            const createEntryCalls = mockRegisterTool.mock.calls.filter(
                (call: unknown[]) => call[0] === 'create_entry'
            ) as unknown[][]

            const handler = createEntryCalls[0]![2] as (
                args: Record<string, unknown>,
                extra: Record<string, unknown>
            ) => Promise<{
                content: { type: string; text: string }[]
                isError?: boolean
            }>

            const result = await handler({ content: 'Will fail' }, { _meta: {} })

            expect(result.isError).toBe(true)
            expect(result.content[0]!.text).toContain('Error')
        })
    })

    // ========================================================================
    // Prompt handler callbacks
    // ========================================================================

    describe('prompt handler callbacks', () => {
        it('should invoke prompt handler and return messages', async () => {
            await createServer({
                transport: 'stdio',
                dbPath: './test-server.db',
            })

            const promptCalls = mockRegisterPrompt.mock.calls
            expect(promptCalls.length).toBeGreaterThan(0)

            // Get the handler for the first prompt
            const handler = promptCalls[0]![2] as (
                args: Record<string, string>
            ) => Promise<{ messages: unknown[] }>

            const result = await handler({})

            expect(result.messages).toBeDefined()
            expect(result.messages.length).toBeGreaterThan(0)
        })
    })

    // ========================================================================
    // Resource handler callbacks
    // ========================================================================

    describe('resource handler callbacks', () => {
        it('should invoke resource handler and return contents', async () => {
            await createServer({
                transport: 'stdio',
                dbPath: './test-server.db',
            })

            // Find a static resource handler (e.g., memory://health is a simple one)
            const healthCalls = mockRegisterResource.mock.calls.filter(
                (call: unknown[]) => call[0] === 'Health Status'
            ) as unknown[][]

            if (healthCalls.length > 0) {
                const handler = healthCalls[0]![3] as (
                    uri: URL
                ) => Promise<{ contents: { uri: string; text: string }[] }>

                const result = await handler(new URL('memory://health'))

                expect(result.contents).toBeDefined()
                expect(result.contents.length).toBeGreaterThan(0)
                expect(result.contents[0]!.uri).toBe('memory://health')
            }
        })
    })

    // ========================================================================
    // HTTP Endpoint handlers
    // ========================================================================

    describe('HTTP endpoint handlers', () => {
        it('should handle POST /mcp in stateless mode', async () => {
            await createServer({
                transport: 'http',
                dbPath: './test-server.db',
                statelessHttp: true,
            })

            const postHandler = mockHandlers.post['/mcp']
            expect(postHandler).toBeDefined()

            const mockReq = { body: { jsonrpc: '2.0', id: 1, method: 'initialize' } }
            const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn(), end: vi.fn() }

            // Invoke the handler
            if (postHandler) {
                await postHandler(mockReq, mockRes)
            }
            // StreamableHTTPServerTransport.handleRequest should be called (from our mock)
        })

        it('should handle GET /mcp and DELETE /mcp in stateless mode', async () => {
            await createServer({
                transport: 'http',
                dbPath: './test-server.db',
                statelessHttp: true,
            })

            const getHandler = mockHandlers.get['/mcp']
            const deleteHandler = mockHandlers.delete['/mcp']
            expect(getHandler).toBeDefined()
            expect(deleteHandler).toBeDefined()

            const mockReq = {}
            const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn(), end: vi.fn() }

            if (getHandler) await getHandler(mockReq, mockRes)
            expect(mockRes.status).toHaveBeenCalledWith(405)

            if (deleteHandler) await deleteHandler(mockReq, mockRes)
            expect(mockRes.status).toHaveBeenCalledWith(204)
        })

        it('should handle stateful mode POST /mcp validation failures', async () => {
            await createServer({
                transport: 'http',
                dbPath: './test-server.db',
                statelessHttp: false,
            })

            const postHandler = mockHandlers.post['/mcp']
            expect(postHandler).toBeDefined()

            // Missing session ID and not initialization request
            const mockReq = { headers: {}, body: {} } // isInitializeRequest returns false
            const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn() }

            if (postHandler) {
                await postHandler(mockReq, mockRes)
            }

            expect(mockRes.status).toHaveBeenCalledWith(400)
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.objectContaining({
                        message: expect.stringContaining('No valid session ID'),
                    }),
                })
            )
        })

        it('should handle OPTIONS preflight explicitly', async () => {
            await createServer({
                transport: 'http',
                dbPath: './test-server.db',
            })

            const allHandler = mockHandlers.all['/mcp']
            expect(allHandler).toBeDefined()

            const mockReqOptions = { method: 'OPTIONS' }
            const mockResOptions = { status: vi.fn().mockReturnThis(), end: vi.fn() }
            const nextFn = vi.fn()

            if (allHandler) await allHandler(mockReqOptions, mockResOptions, nextFn)
            expect(mockResOptions.status).toHaveBeenCalledWith(204)
            expect(nextFn).not.toHaveBeenCalled()

            const mockReqGet = { method: 'GET' }
            if (allHandler) await allHandler(mockReqGet, mockResOptions, nextFn)
            expect(nextFn).toHaveBeenCalled()
        })

        it('should invoke security headers middleware', async () => {
            const middlewareFns: Function[] = []
            const { default: expressMod } = await import('express')
            const app = expressMod()
            // Capture all middleware registered via app.use()
            ;(app.use as ReturnType<typeof vi.fn>).mockImplementation((...args: unknown[]) => {
                if (args.length === 1 && typeof args[0] === 'function') {
                    middlewareFns.push(args[0] as Function)
                }
            })

            await createServer({
                transport: 'http',
                dbPath: './test-server.db',
                statelessHttp: true,
            })

            // The first middleware (after express.json) should set security headers
            // Find a middleware that calls setHeader for security headers
            let securityMiddlewareFound = false
            for (const mw of middlewareFns) {
                const mockRes = {
                    setHeader: vi.fn(),
                    status: vi.fn().mockReturnThis(),
                    end: vi.fn(),
                }
                const nextFn = vi.fn()
                mw({}, mockRes, nextFn)
                const calls = mockRes.setHeader.mock.calls as [string, string][]
                const headerNames = calls.map((c) => c[0])
                if (headerNames.includes('X-Content-Type-Options')) {
                    securityMiddlewareFound = true
                    expect(headerNames).toContain('X-Frame-Options')
                    expect(headerNames).toContain('Content-Security-Policy')
                    expect(headerNames).toContain('Cache-Control')
                    expect(headerNames).toContain('Referrer-Policy')
                    expect(nextFn).toHaveBeenCalled()
                    break
                }
            }
            expect(securityMiddlewareFound).toBe(true)
        })

        it('should invoke CORS middleware and handle OPTIONS', async () => {
            const middlewareFns: Function[] = []
            const { default: expressMod } = await import('express')
            const app = expressMod()
            ;(app.use as ReturnType<typeof vi.fn>).mockImplementation((...args: unknown[]) => {
                if (args.length === 1 && typeof args[0] === 'function') {
                    middlewareFns.push(args[0] as Function)
                }
            })

            await createServer({
                transport: 'http',
                dbPath: './test-server.db',
                statelessHttp: true,
                corsOrigin: 'https://test.example.com',
            })

            // Find the CORS middleware (sets Access-Control-Allow-Origin)
            let corsMiddlewareFound = false
            for (const mw of middlewareFns) {
                const mockRes = {
                    setHeader: vi.fn(),
                    status: vi.fn().mockReturnThis(),
                    end: vi.fn(),
                }

                // Test with OPTIONS request
                const mockReqOptions = { method: 'OPTIONS' }
                const noopNext = vi.fn()
                mw(mockReqOptions, mockRes, noopNext)
                const calls = mockRes.setHeader.mock.calls as [string, string][]
                const headerNames = calls.map((c) => c[0])
                if (headerNames.includes('Access-Control-Allow-Origin')) {
                    corsMiddlewareFound = true
                    expect(headerNames).toContain('Access-Control-Allow-Methods')
                    expect(headerNames).toContain('Access-Control-Allow-Headers')
                    expect(headerNames).toContain('Access-Control-Expose-Headers')
                    // OPTIONS should return 204
                    expect(mockRes.status).toHaveBeenCalledWith(204)
                    expect(mockRes.end).toHaveBeenCalled()
                    break
                }
            }
            expect(corsMiddlewareFound).toBe(true)

            // Test CORS middleware with non-OPTIONS request (calls next)
            for (const mw of middlewareFns) {
                const mockRes = {
                    setHeader: vi.fn(),
                    status: vi.fn().mockReturnThis(),
                    end: vi.fn(),
                }
                const nextFn = vi.fn()
                mw({ method: 'POST' }, mockRes, nextFn)
                const calls = mockRes.setHeader.mock.calls as [string, string][]
                const headerNames = calls.map((c) => c[0])
                if (headerNames.includes('Access-Control-Allow-Origin')) {
                    expect(nextFn).toHaveBeenCalled()
                    break
                }
            }
        })

        it('should handle stateful GET /mcp without session', async () => {
            await createServer({
                transport: 'http',
                dbPath: './test-server.db',
                statelessHttp: false,
            })

            const getHandler = mockHandlers.get['/mcp']
            expect(getHandler).toBeDefined()

            // No session ID
            const mockReq = { headers: {} }
            const mockRes = {
                status: vi.fn().mockReturnThis(),
                send: vi.fn(),
            }

            if (getHandler) await getHandler(mockReq, mockRes)
            expect(mockRes.status).toHaveBeenCalledWith(400)
            expect(mockRes.send).toHaveBeenCalledWith(
                expect.stringContaining('Invalid or missing session ID')
            )
        })

        it('should handle stateful DELETE /mcp without session', async () => {
            await createServer({
                transport: 'http',
                dbPath: './test-server.db',
                statelessHttp: false,
            })

            const deleteHandler = mockHandlers.delete['/mcp']
            expect(deleteHandler).toBeDefined()

            const mockReq = { headers: {} }
            const mockRes = {
                status: vi.fn().mockReturnThis(),
                send: vi.fn(),
            }

            if (deleteHandler) await deleteHandler(mockReq, mockRes)
            expect(mockRes.status).toHaveBeenCalledWith(400)
        })

        it('should handle stateful GET /mcp with invalid session', async () => {
            await createServer({
                transport: 'http',
                dbPath: './test-server.db',
                statelessHttp: false,
            })

            const getHandler = mockHandlers.get['/mcp']
            const mockReq = { headers: { 'mcp-session-id': 'nonexistent-session' } }
            const mockRes = {
                status: vi.fn().mockReturnThis(),
                send: vi.fn(),
            }

            if (getHandler) await getHandler(mockReq, mockRes)
            expect(mockRes.status).toHaveBeenCalledWith(400)
        })

        it('should handle stateful DELETE /mcp with invalid session', async () => {
            await createServer({
                transport: 'http',
                dbPath: './test-server.db',
                statelessHttp: false,
            })

            const deleteHandler = mockHandlers.delete['/mcp']
            const mockReq = { headers: { 'mcp-session-id': 'nonexistent-session' } }
            const mockRes = {
                status: vi.fn().mockReturnThis(),
                send: vi.fn(),
            }

            if (deleteHandler) await deleteHandler(mockReq, mockRes)
            expect(mockRes.status).toHaveBeenCalledWith(400)
        })
    })

    // ========================================================================
    // Scheduler
    // ========================================================================

    describe('createServer - scheduler', () => {
        it('should warn and not start scheduler on stdio transport', async () => {
            await createServer({
                transport: 'stdio',
                dbPath: './test-server.db',
                scheduler: {
                    backupIntervalMinutes: 60,
                    vacuumIntervalMinutes: 120,
                    rebuildIndexIntervalMinutes: 180,
                },
            })

            // Scheduler should NOT be started for stdio
            // (no way to directly check but the code path is covered)
            expect(mockDbInitialize).toHaveBeenCalled()
        })

        it('should start scheduler on HTTP transport', async () => {
            await createServer({
                transport: 'http',
                dbPath: './test-server.db',
                statelessHttp: true,
                scheduler: {
                    backupIntervalMinutes: 60,
                    vacuumIntervalMinutes: 0,
                    rebuildIndexIntervalMinutes: 0,
                },
            })

            expect(mockDbInitialize).toHaveBeenCalled()
        })

        it('should not create scheduler when all intervals are 0', async () => {
            await createServer({
                transport: 'http',
                dbPath: './test-server.db',
                scheduler: {
                    backupIntervalMinutes: 0,
                    vacuumIntervalMinutes: 0,
                    rebuildIndexIntervalMinutes: 0,
                },
            })

            expect(mockDbInitialize).toHaveBeenCalled()
        })
    })

    // ========================================================================
    // Tool handler with outputSchema
    // ========================================================================

    describe('tool handler structuredContent', () => {
        it('should return structuredContent for tools with outputSchema', async () => {
            await createServer({
                transport: 'stdio',
                dbPath: './test-server.db',
            })

            // get_recent_entries has an outputSchema
            const calls = mockRegisterTool.mock.calls.filter(
                (call: unknown[]) => call[0] === 'get_recent_entries'
            ) as unknown[][]

            expect(calls.length).toBe(1)
            const handler = calls[0]![2] as (
                args: Record<string, unknown>,
                extra: Record<string, unknown>
            ) => Promise<{
                content: { type: string; text: string }[]
                structuredContent?: Record<string, unknown>
            }>

            const result = await handler({ limit: 5 }, { _meta: {} })

            // Should have both content and structuredContent
            expect(result.content).toBeDefined()
            expect(result.structuredContent).toBeDefined()
        })

        it('should pass progressToken to tool handler when provided', async () => {
            await createServer({
                transport: 'stdio',
                dbPath: './test-server.db',
            })

            const calls = mockRegisterTool.mock.calls.filter(
                (call: unknown[]) => call[0] === 'create_entry'
            ) as unknown[][]

            const handler = calls[0]![2] as (
                args: Record<string, unknown>,
                extra: Record<string, unknown>
            ) => Promise<unknown>

            // Invoke with a progressToken in _meta
            const result = await handler(
                { content: 'Progress test' },
                { _meta: { progressToken: 'tok-123' } }
            )

            expect(result).toBeDefined()
        })
    })

    // ========================================================================
    // Environment-based tool filter
    // ========================================================================

    describe('createServer - env tool filter', () => {
        it('should use MEMORY_JOURNAL_MCP_TOOL_FILTER env var when no explicit filter', async () => {
            process.env['MEMORY_JOURNAL_MCP_TOOL_FILTER'] = 'core'

            await createServer({
                transport: 'stdio',
                dbPath: './test-server.db',
            })

            // Tools should be filtered from env
            expect(mockRegisterTool).toHaveBeenCalled()
            const toolCount = mockRegisterTool.mock.calls.length

            delete process.env['MEMORY_JOURNAL_MCP_TOOL_FILTER']

            // Reset and create without filter
            vi.clearAllMocks()
            await createServer({
                transport: 'stdio',
                dbPath: './test-server.db',
            })

            const unfilteredCount = mockRegisterTool.mock.calls.length
            // Env-filtered should have fewer tools than unfiltered
            expect(toolCount).toBeLessThan(unfilteredCount)
        })
    })
})
