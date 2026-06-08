import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ConfigResolver } from '../../src/utils/config-resolver.js'
import { Command } from 'commander'
import * as fs from 'node:fs'
import * as path from 'node:path'

vi.mock('node:fs')

describe('ConfigResolver', () => {
    let mockCommand: any
    let cliOptions: Record<string, unknown>
    let originalEnv: NodeJS.ProcessEnv

    beforeEach(() => {
        originalEnv = { ...process.env }
        
        mockCommand = {
            getOptionValueSource: vi.fn()
        }

        cliOptions = {}

        // Mock fs methods
        vi.mocked(fs.existsSync).mockReturnValue(false)
        vi.mocked(fs.readFileSync).mockReturnValue('')
    })

    afterEach(() => {
        process.env = { ...originalEnv }
        vi.resetAllMocks()
    })

    it('resolves from CLI when explicitly provided', () => {
        mockCommand.getOptionValueSource.mockReturnValue('cli')
        cliOptions['port'] = 4000
        
        const resolver = new ConfigResolver(mockCommand as Command, cliOptions)
        const result = resolver.resolve('port', 'PORT')
        
        expect(result).toBe(4000)
    })

    it('resolves from ENV when CLI falls back to default', () => {
        mockCommand.getOptionValueSource.mockReturnValue('default')
        cliOptions['port'] = 3000 // default value
        process.env['PORT'] = '5000'
        
        const resolver = new ConfigResolver(mockCommand as Command, cliOptions)
        const result = resolver.resolve('port', 'PORT', (val) => Number(val))
        
        expect(result).toBe(5000)
    })

    it('resolves from Config File when CLI is default and ENV is unset', () => {
        mockCommand.getOptionValueSource.mockReturnValue('default')
        cliOptions['port'] = 3000
        delete process.env['PORT']

        vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => String(p).endsWith('memory-journal.config.json'))
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ port: 6000 }))

        const resolver = new ConfigResolver(mockCommand as Command, cliOptions)
        const result = resolver.resolve('port', 'PORT')
        
        expect(result).toBe(6000)
    })

    it('falls back to default when CLI is default, ENV is unset, and Config is empty', () => {
        mockCommand.getOptionValueSource.mockReturnValue('default')
        cliOptions['port'] = 3000
        delete process.env['PORT']

        const resolver = new ConfigResolver(mockCommand as Command, cliOptions)
        const result = resolver.resolve('port', 'PORT')
        
        expect(result).toBe(3000)
    })

    it('parses YAML config files correctly', () => {
        mockCommand.getOptionValueSource.mockReturnValue('default')
        cliOptions['logLevel'] = 'info'

        vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => String(p).endsWith('memory-journal.config.yaml'))
        vi.mocked(fs.readFileSync).mockReturnValue('logLevel: debug\n')

        const resolver = new ConfigResolver(mockCommand as Command, cliOptions)
        const result = resolver.resolve('logLevel', 'LOG_LEVEL')
        
        expect(result).toBe('debug')
    })

    it('resolveIntRequired throws if value cannot be parsed or is missing', () => {
        const resolver = new ConfigResolver(mockCommand as Command, cliOptions)
        
        expect(() => resolver.resolveIntRequired('port', 'PORT')).toThrow(/Missing required numeric configuration/)
        
        cliOptions['port'] = 'not-a-number'
        mockCommand.getOptionValueSource.mockReturnValue('cli')
        
        expect(() => resolver.resolveIntRequired('port', 'PORT')).toThrow(/Invalid required numeric configuration/)
    })

    it('resolveBool handles string "true" and "false"', () => {
        mockCommand.getOptionValueSource.mockReturnValue('env')
        process.env['STATELESS'] = 'true'
        
        const resolver = new ConfigResolver(mockCommand as Command, cliOptions)
        expect(resolver.resolveBool('stateless', 'STATELESS')).toBe(true)
        
        process.env['STATELESS'] = 'false'
        expect(resolver.resolveBool('stateless', 'STATELESS')).toBe(false)
    })

    it('resolveStringArray handles actual arrays and comma-separated strings', () => {
        mockCommand.getOptionValueSource.mockReturnValue('default')
        cliOptions['allowedIoRoots'] = '/path1, /path2'
        
        let resolver = new ConfigResolver(mockCommand as Command, cliOptions)
        expect(resolver.resolveStringArray('allowedIoRoots')).toEqual(['/path1', '/path2'])

        mockCommand.getOptionValueSource.mockReturnValue('cli')
        cliOptions['allowedIoRoots'] = ['/path1', '/path2']
        resolver = new ConfigResolver(mockCommand as Command, cliOptions)
        expect(resolver.resolveStringArray('allowedIoRoots')).toEqual(['/path1', '/path2'])
    })

    it('throws if explicitly provided config file does not exist', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false)
        expect(() => {
            new ConfigResolver(mockCommand as Command, cliOptions, 'missing-config.yaml')
        }).toThrow(/Failed to load config file/)
    })

    it('silently ignores missing default config files', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false)
        // Should not throw
        const resolver = new ConfigResolver(mockCommand as Command, cliOptions)
        expect(resolver).toBeDefined()
    })
})
