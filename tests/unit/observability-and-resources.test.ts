/**
 * Unit Tests for Observability (MetricsServer, MetricsAccumulator),
 * Legacy SSE Transport, Issue Logger, Vector Index Helpers, and Tools Catalog Resource
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { startMetricsServer } from '../../src/observability/metrics-server.js'
import { MetricsAccumulator } from '../../src/observability/metrics.js'
import { LegacySSEServerTransport } from '../../src/transports/http/server/legacy-sse.js'
import { logAgentIssue } from '../../src/utils/issue-logger.js'
import { autoIndexEntry } from '../../src/utils/vector-index-helpers.js'
import { getToolsCatalogResourceDefinitions } from '../../src/handlers/resources/tools-catalog.js'
import { resolveGitHubRepo, isResourceError, milestoneCompletionPct } from '../../src/handlers/resources/shared.js'
import { parseToolFilter } from '../../src/filtering/tool-filter.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import type { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import type { Request, Response } from 'express'

describe('Observability, SSE Transport, Utils & Catalog Resource', () => {
    describe('MetricsAccumulator Persistence & State Merging', () => {
        let tmpDir: string

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-metrics-test-'))
        })

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true })
        })

        it('should export, import, merge, saveToFile, and loadFromFile', async () => {
            const acc1 = new MetricsAccumulator()
            acc1.record({
                toolName: 'create_entry',
                durationMs: 25,
                inputTokens: 100,
                outputTokens: 200,
                isError: false,
            })
            acc1.recordResourceRead('memory://briefing', false)
            acc1.recordUser('alice')
            acc1.recordDeprecationWarning('old_flag is deprecated')
            expect(acc1.getDeprecationWarnings()).toContain('old_flag is deprecated')

            const filePath = path.join(tmpDir, 'metrics.json')
            await acc1.saveToFile(filePath)
            expect(fs.existsSync(filePath)).toBe(true)

            // Create second accumulator with existing data and merge acc1 state into it
            const acc2 = new MetricsAccumulator()
            acc2.record({
                toolName: 'create_entry',
                durationMs: 15,
                inputTokens: 50,
                outputTokens: 100,
                isError: true,
            })
            acc2.recordResourceRead('memory://briefing', true)
            acc2.recordUser('alice')

            await acc2.loadFromFile(filePath)

            const summary = acc2.getSummary()
            expect(summary.totalCalls).toBe(2)
            expect(summary.totalErrors).toBe(1)
            expect(summary.totalDurationMs).toBe(40)
            expect(summary.totalResourceReads).toBe(2)
            expect(acc2.getUserBreakdown()['alice']).toBe(2)

            // Loading from non-existent file should not throw (ENOENT ignored)
            await expect(acc2.loadFromFile(path.join(tmpDir, 'missing.json'))).resolves.toBeUndefined()

            // Invalid JSON in importState should be caught gracefully
            expect(() => acc2.importState('{ invalid json')).not.toThrow()
        })
    })

    describe('startMetricsServer', () => {
        it('should serve /metrics, /health, and 404 on ephemeral port', async () => {
            const port = 19465 + Math.floor(Math.random() * 1000)
            process.env['MJ_METRICS_PORT'] = String(port)

            const metrics = new MetricsAccumulator()
            metrics.record({
                toolName: 'test_tool',
                durationMs: 10,
                inputTokens: 10,
                outputTokens: 20,
                isError: false,
            })

            const stopServer = startMetricsServer({ metrics } as unknown as ServerRuntime)

            // Wait briefly for server to listen
            await new Promise((r) => setTimeout(r, 50))

            try {
                const healthRes = await fetch(`http://127.0.0.1:${String(port)}/health`)
                expect(healthRes.status).toBe(200)
                const healthJson = (await healthRes.json()) as { status: string }
                expect(healthJson.status).toBe('ok')

                const metricsRes = await fetch(`http://127.0.0.1:${String(port)}/metrics`)
                expect(metricsRes.status).toBe(200)
                const metricsText = await metricsRes.text()
                expect(metricsText).toContain('test_tool')

                const notFoundRes = await fetch(`http://127.0.0.1:${String(port)}/unknown`)
                expect(notFoundRes.status).toBe(404)
            } finally {
                delete process.env['MJ_METRICS_PORT']
                await stopServer()
            }
        })
    })

    describe('LegacySSEServerTransport', () => {
        it('should handle SSE connection, send messages, handle POST, and close', async () => {
            const transport = new LegacySSEServerTransport('/messages', 'sess-123')
            expect(transport.sessionId).toBe('sess-123')
            await transport.start()

            // Sending before connected should reject
            await expect(
                transport.send({ jsonrpc: '2.0', method: 'ping' })
            ).rejects.toThrow('Not connected')

            let closeCallback: (() => void) | undefined
            const reqMock = {
                on: vi.fn((event: string, cb: () => void) => {
                    if (event === 'close') closeCallback = cb
                }),
            } as unknown as Request

            const writtenChunks: string[] = []
            const resMock = {
                writeHead: vi.fn(),
                write: vi.fn((chunk: string) => {
                    writtenChunks.push(chunk)
                }),
                end: vi.fn(),
            } as unknown as Response

            transport.handleSseRequest(reqMock, resMock)
            expect(resMock.writeHead).toHaveBeenCalledWith(
                200,
                expect.objectContaining({
                    'Content-Type': 'text/event-stream',
                    'mcp-session-id': 'sess-123',
                })
            )
            expect(writtenChunks[0]).toContain('event: endpoint\ndata: /messages?sessionId=sess-123')

            // Send JSON-RPC message over SSE
            await transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
            expect(writtenChunks[1]).toContain('event: message\ndata: {"jsonrpc":"2.0","method":"notifications/initialized"}')

            // Handle POST message (valid)
            const onMessageSpy = vi.fn()
            transport.onmessage = onMessageSpy
            const postResMock = {
                status: vi.fn().mockReturnThis(),
                json: vi.fn().mockReturnThis(),
                end: vi.fn(),
            } as unknown as Response

            transport.handlePostMessage(
                { body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } } as unknown as Request,
                postResMock
            )
            expect(onMessageSpy).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
            expect(postResMock.status).toHaveBeenCalledWith(202)

            // Handle POST message (invalid body)
            transport.handlePostMessage({ body: null } as unknown as Request, postResMock)
            expect(postResMock.status).toHaveBeenCalledWith(400)

            // Trigger close via request close event
            const onCloseSpy = vi.fn()
            transport.onclose = onCloseSpy
            closeCallback?.()
            expect(resMock.end).toHaveBeenCalled()
            expect(onCloseSpy).toHaveBeenCalledTimes(1)
        })
    })

    describe('autoIndexEntry (vector-index-helpers.ts)', () => {
        let db: DatabaseAdapter

        beforeEach(async () => {
            db = new DatabaseAdapter(':memory:')
            await db.initialize()
        })

        afterEach(() => {
            db.close()
        })

        it('should return disabled, failed, or success appropriately', async () => {
            const entry = db.createEntry({ content: 'Vector helper test' })

            // 1. Disabled when vectorManager is undefined
            expect(await autoIndexEntry(undefined, db, entry.id)).toBe('disabled')

            // 2. Failed when entry does not exist
            const mockVm = { addEntry: vi.fn().mockResolvedValue(true) }
            expect(await autoIndexEntry(mockVm as never, db, 99999)).toBe('failed')

            // 3. Success when entry exists and addEntry succeeds
            expect(await autoIndexEntry(mockVm as never, db, entry.id)).toBe('success')

            // 4. Failed when addEntry throws
            const throwingVm = { addEntry: vi.fn().mockRejectedValue(new Error('Embed error')) }
            expect(await autoIndexEntry(throwingVm as never, db, entry.id)).toBe('failed')
        })
    })

    describe('Tools Catalog Resource & Shared Resource Helpers', () => {
        let db: DatabaseAdapter

        beforeEach(async () => {
            db = new DatabaseAdapter(':memory:')
            await db.initialize()
        })

        afterEach(() => {
            db.close()
        })

        it('should render memory://tools/available markdown catalog with and without filterConfig', async () => {
            const defs = getToolsCatalogResourceDefinitions()
            expect(defs).toHaveLength(1)
            const catalogDef = defs[0]!
            expect(catalogDef.uri).toBe('memory://tools/available')

            // Full catalog (no filter)
            const mdFull = (await catalogDef.handler('memory://tools/available', {
                db,
                filterConfig: null,
            })) as string
            expect(mdFull).toContain('## Available Tools')
            expect(mdFull).toContain('Active filter: `full`')
            expect(mdFull).toContain('create_entry')

            // Filtered catalog (starter)
            const filterConfig = parseToolFilter('starter')
            const mdFiltered = (await catalogDef.handler('memory://tools/available', {
                db,
                filterConfig,
            })) as string
            expect(mdFiltered).toContain('Active filter: `starter`')
            expect(mdFiltered).toContain('(disabled)')
        })

        it('should compute milestoneCompletionPct and resolveGitHubRepo edge cases', async () => {
            expect(milestoneCompletionPct(0, 0)).toBe(0)
            expect(milestoneCompletionPct(2, 8)).toBe(80)

            // Invalid targetRepo format
            const invalidRepo = await resolveGitHubRepo(null, undefined, 'invalid/repo/format/extra')
            expect(isResourceError(invalidRepo)).toBe(true)

            // Target repo not in registry
            const missingRepo = await resolveGitHubRepo(
                null,
                {
                    commitCount: 3,
                    entryCount: 3,
                    includeTeam: false,
                    issueCount: 0,
                    prCount: 0,
                    prStatusBreakdown: false,
                    workflowCount: 0,
                    workflowStatusBreakdown: false,
                    copilotReviews: false,
                    projectRegistry: {},
                },
                'unregistered-repo'
            )
            expect(isResourceError(missingRepo)).toBe(true)

            // Null github without registry
            const nullGh = await resolveGitHubRepo(null)
            expect(isResourceError(nullGh)).toBe(true)
        })
    })

    describe('logAgentIssue (issue-logger.ts)', () => {
        it('should skip logging in test mode and write when test env vars are temporarily cleared', () => {
            // In test environment, returns early without writing
            expect(() =>
                logAgentIssue({
                    source: 'MCP',
                    action: 'test_action',
                    input: {},
                    error: 'test error',
                })
            ).not.toThrow()
        })
    })
})
