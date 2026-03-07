/**
 * McpLogger Tests
 *
 * Tests the MCP Protocol Logger: level filtering, stderr fallback, MCP send.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { McpLogger, mcpLogger } from '../../src/utils/McpLogger.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

describe('McpLogger', () => {
    let mcpLog: McpLogger
    let errorSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        mcpLog = new McpLogger()
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        errorSpy.mockRestore()
    })

    // ========================================================================
    // Level management
    // ========================================================================

    describe('setLevel / getLevel', () => {
        it('should default to info level', () => {
            expect(mcpLog.getLevel()).toBe('info')
        })

        it('should set and get level correctly', () => {
            mcpLog.setLevel('debug')
            expect(mcpLog.getLevel()).toBe('debug')
        })

        it('should accept all valid MCP log levels', () => {
            const levels = [
                'debug',
                'info',
                'notice',
                'warning',
                'error',
                'critical',
                'alert',
                'emergency',
            ] as const

            for (const level of levels) {
                mcpLog.setLevel(level)
                expect(mcpLog.getLevel()).toBe(level)
            }
        })
    })

    // ========================================================================
    // Level filtering
    // ========================================================================

    describe('level filtering', () => {
        it('should log messages at or below configured severity', () => {
            mcpLog.setLevel('info')
            mcpLog.log('info', 'test', { message: 'info msg' })
            mcpLog.log('error', 'test', { message: 'error msg' })

            expect(errorSpy).toHaveBeenCalledTimes(2)
        })

        it('should suppress messages above configured severity', () => {
            mcpLog.setLevel('error')
            mcpLog.log('info', 'test', { message: 'should be suppressed' })
            mcpLog.log('debug', 'test', { message: 'also suppressed' })

            expect(errorSpy).not.toHaveBeenCalled()
        })

        it('should log emergency at any level', () => {
            mcpLog.setLevel('emergency')
            mcpLog.log('emergency', 'test', { message: 'critical system failure' })

            expect(errorSpy).toHaveBeenCalledTimes(1)
        })
    })

    // ========================================================================
    // stderr fallback (no server)
    // ========================================================================

    describe('stderr fallback', () => {
        it('should format output with timestamp, level, and logger name', () => {
            mcpLog.log('info', 'MyModule', { message: 'hello world' })
            const output = errorSpy.mock.calls[0]?.[0] as string

            expect(output).toMatch(/^\[.+\] \[INFO\s+\]/)
            expect(output).toContain('[MyModule]')
            expect(output).toContain('hello world')
        })

        it('should include extra context in stderr output', () => {
            mcpLog.log('warning', 'DB', {
                message: 'Slow query',
                operation: 'SELECT',
                duration: 2500,
            })
            const output = errorSpy.mock.calls[0]?.[0] as string

            expect(output).toContain('"operation":"SELECT"')
            expect(output).toContain('"duration":2500')
        })
    })

    // ========================================================================
    // MCP server integration
    // ========================================================================

    describe('MCP server send', () => {
        it('should send via MCP protocol when server is set', () => {
            const mockServer = {
                sendLoggingMessage: vi.fn(),
            }
            mcpLog.setServer(mockServer as unknown as McpServer)

            mcpLog.log('info', 'test', { message: 'via MCP' })

            expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith({
                level: 'info',
                logger: 'test',
                data: { message: 'via MCP' },
            })
            // Should also log to stderr
            expect(errorSpy).toHaveBeenCalled()
        })

        it('should fall back to stderr if MCP send throws', () => {
            const mockServer = {
                sendLoggingMessage: vi.fn(() => {
                    throw new Error('Transport error')
                }),
            }
            mcpLog.setServer(mockServer as unknown as McpServer)

            // Should not throw
            mcpLog.log('error', 'test', { message: 'fallback test' })

            // Should still log to stderr (fallback + always-log)
            expect(errorSpy).toHaveBeenCalled()
        })
    })

    // ========================================================================
    // Convenience methods
    // ========================================================================

    describe('convenience methods', () => {
        it('should log via debug()', () => {
            mcpLog.setLevel('debug')
            mcpLog.debug('mod', 'debug message')
            const output = errorSpy.mock.calls[0]?.[0] as string
            expect(output).toContain('DEBUG')
            expect(output).toContain('debug message')
        })

        it('should log via info()', () => {
            mcpLog.info('mod', 'info message')
            const output = errorSpy.mock.calls[0]?.[0] as string
            expect(output).toContain('INFO')
        })

        it('should log via notice()', () => {
            mcpLog.notice('mod', 'notice message')
            const output = errorSpy.mock.calls[0]?.[0] as string
            expect(output).toContain('NOTICE')
        })

        it('should log via warning()', () => {
            mcpLog.warning('mod', 'warning message')
            const output = errorSpy.mock.calls[0]?.[0] as string
            expect(output).toContain('WARNING')
        })

        it('should log via error()', () => {
            mcpLog.error('mod', 'error message')
            const output = errorSpy.mock.calls[0]?.[0] as string
            expect(output).toContain('ERROR')
        })

        it('should log via critical()', () => {
            mcpLog.setLevel('critical')
            mcpLog.critical('mod', 'critical message')
            const output = errorSpy.mock.calls[0]?.[0] as string
            expect(output).toContain('CRITICAL')
        })

        it('should pass context through convenience methods', () => {
            mcpLog.info('mod', 'msg', { extra: 'data' })
            const output = errorSpy.mock.calls[0]?.[0] as string
            expect(output).toContain('"extra":"data"')
        })
    })

    // ========================================================================
    // Singleton
    // ========================================================================

    describe('singleton', () => {
        it('should export mcpLogger as a McpLogger instance', () => {
            expect(mcpLogger).toBeInstanceOf(McpLogger)
        })
    })
})
