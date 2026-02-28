/**
 * Logger Tests
 *
 * Tests the stderr Logger class: level filtering, formatting, sanitization.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger } from '../../src/utils/logger.js'

describe('Logger', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        errorSpy.mockRestore()
        // Reset to default level
        logger.setLevel('info')
    })

    // ========================================================================
    // Level filtering
    // ========================================================================

    describe('level filtering', () => {
        it('should log messages at or below the configured level', () => {
            logger.setLevel('info')
            logger.info('info message')
            logger.error('error message')

            expect(errorSpy).toHaveBeenCalledTimes(2)
        })

        it('should suppress messages above the configured level', () => {
            logger.setLevel('error')
            logger.debug('debug message')
            logger.info('info message')
            logger.notice('notice message')
            logger.warning('warning message')

            expect(errorSpy).not.toHaveBeenCalled()
        })

        it('should allow debug messages at debug level', () => {
            logger.setLevel('debug')
            logger.debug('debug message')

            expect(errorSpy).toHaveBeenCalledTimes(1)
        })

        it('should log critical messages at any level', () => {
            logger.setLevel('critical')
            logger.critical('critical failure')

            expect(errorSpy).toHaveBeenCalledTimes(1)
        })
    })

    // ========================================================================
    // Formatting
    // ========================================================================

    describe('formatting', () => {
        it('should include timestamp, level, and message', () => {
            logger.info('test message')
            const output = errorSpy.mock.calls[0]?.[0] as string

            // [timestamp] [LEVEL   ] message
            expect(output).toMatch(/^\[.+\] \[INFO\s+\]/)
            expect(output).toContain('test message')
        })

        it('should include module when provided', () => {
            logger.info('test', { module: 'TestModule' })
            const output = errorSpy.mock.calls[0]?.[0] as string

            expect(output).toContain('[TestModule]')
        })

        it('should include operation when provided', () => {
            logger.info('test', { operation: 'doSomething' })
            const output = errorSpy.mock.calls[0]?.[0] as string

            expect(output).toContain('[doSomething]')
        })

        it('should include extra context fields as JSON', () => {
            logger.info('test', { module: 'M', entityId: 42 })
            const output = errorSpy.mock.calls[0]?.[0] as string

            expect(output).toContain('"entityId":42')
        })

        it('should omit extras JSON when no extra fields', () => {
            logger.info('plain message')
            const output = errorSpy.mock.calls[0]?.[0] as string

            // Should not contain JSON braces (from extras)
            expect(output).not.toContain('{')
        })
    })

    // ========================================================================
    // Sanitization
    // ========================================================================

    describe('sanitization', () => {
        it('should sanitize error field containing tokens', () => {
            const token = 'ghp_' + 'X'.repeat(36)
            logger.error('Request failed', {
                module: 'GitHub',
                error: `Token ${token} expired`,
            })
            const output = errorSpy.mock.calls[0]?.[0] as string

            expect(output).not.toContain(token)
            expect(output).toContain('[REDACTED]')
        })

        it('should not sanitize non-string error fields', () => {
            logger.error('Error occurred', {
                module: 'DB',
                error: 500,
            })
            const output = errorSpy.mock.calls[0]?.[0] as string

            expect(output).toContain('"error":500')
        })
    })

    // ========================================================================
    // setLevel
    // ========================================================================

    describe('setLevel', () => {
        it('should change the minimum log level', () => {
            logger.setLevel('critical')
            logger.error('should not appear')
            expect(errorSpy).not.toHaveBeenCalled()

            logger.setLevel('error')
            logger.error('should appear')
            expect(errorSpy).toHaveBeenCalledTimes(1)
        })
    })

    // ========================================================================
    // Convenience methods
    // ========================================================================

    describe('convenience methods', () => {
        it('should log via debug()', () => {
            logger.setLevel('debug')
            logger.debug('debug msg')
            const output = errorSpy.mock.calls[0]?.[0] as string
            expect(output).toContain('DEBUG')
        })

        it('should log via notice()', () => {
            logger.notice('notice msg')
            const output = errorSpy.mock.calls[0]?.[0] as string
            expect(output).toContain('NOTICE')
        })

        it('should log via warning()', () => {
            logger.warning('warning msg')
            const output = errorSpy.mock.calls[0]?.[0] as string
            expect(output).toContain('WARNING')
        })

        it('should log via critical()', () => {
            logger.setLevel('critical')
            logger.critical('critical msg')
            const output = errorSpy.mock.calls[0]?.[0] as string
            expect(output).toContain('CRITICAL')
        })
    })
})
