import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { parse as parseYaml } from 'yaml'
import type { Command } from 'commander'
import { logger } from './logger.js'
import { ConfigurationError } from '../types/errors.js'

export interface ResolvedConfigValue<T> {
    value: T
    source: 'cli' | 'env' | 'config' | 'default'
}

export class ConfigResolver {
    private configFileOptions: Record<string, unknown> = {}
    public loadedConfigPath?: string


    constructor(
        private command: Command,
        private cliOptions: Record<string, unknown>,
        configPathOverride?: string
    ) {
        this.loadConfigFile(configPathOverride)
    }

    private loadConfigFile(configPathOverride?: string): void {
        const pathsToTry = configPathOverride
            ? [path.resolve(configPathOverride)]
            : [
                  path.resolve(process.cwd(), 'memory-journal.config.yaml'),
                  path.resolve(process.cwd(), 'memory-journal.config.yml'),
                  path.resolve(process.cwd(), 'memory-journal.config.json'),
                  path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json'),
                  path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.yaml'),
                  path.resolve(os.homedir(), '.memory-journal', 'config.json'),
              ]

        for (const filePath of pathsToTry) {
            if (!fs.existsSync(filePath)) {
                if (configPathOverride) {
                    throw new ConfigurationError(`Failed to load config file ${filePath}: File does not exist`)
                }
                continue
            }
            try {
                const content = fs.readFileSync(filePath, 'utf-8')
                if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
                    this.configFileOptions = (parseYaml(content) as Record<string, unknown>) ?? {}
                } else {
                    this.configFileOptions = (JSON.parse(content) as Record<string, unknown>) ?? {}
                }
                this.loadedConfigPath = filePath
                logger.info('Loaded configuration from file', {
                    module: 'ConfigResolver',
                    path: filePath,
                })
                return
            } catch (error) {
                // If override was provided and fails, throw
                if (configPathOverride) {
                    throw new ConfigurationError(`Failed to load config file ${filePath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error instanceof Error ? error : undefined })
                }
                // Otherwise silently continue to next default path
            }
        }
    }

    /**
     * Resolves a configuration option following precedence:
     * CLI flag > Env Var > Config File > Default
     */
    public resolve<T>(
        cliKey: string,
        envKey?: string,
        parser?: (val: unknown) => T
    ): T | undefined {
        let value: unknown
        let source: 'cli' | 'env' | 'config' | 'default' = 'default'

        // 1. CLI flag (Check if it was explicitly passed vs default)
        let isCliSource: boolean
        try {
            isCliSource = this.command.getOptionValueSource(cliKey) === 'cli'
        } catch {
            // Key not registered in Commander
            isCliSource = false
        }
        
        if (isCliSource) {
            value = this.cliOptions[cliKey]
            source = 'cli'
        }
        // 2. Env Var
        else if (envKey && process.env[envKey] !== undefined) {
            value = process.env[envKey]
            source = 'env'
        }
        // 3. Config File
        else if (this.configFileOptions[cliKey] !== undefined) {
            value = this.configFileOptions[cliKey]
            source = 'config'
        }
        // 4. Default from Commander
        else {
            value = this.cliOptions[cliKey]
        }

        if (value === undefined) {
            return undefined
        }

        try {
            return parser ? parser(value) : (value as T)
        } catch (err) {
            throw new ConfigurationError(`Failed to parse configuration for ${cliKey} (source: ${source}): ${err instanceof Error ? err.message : String(err)}`, { cause: err instanceof Error ? err : undefined })
        }
    }

    /**
     * Helper to resolve a required numeric value
     */
    public resolveIntRequired(
        cliKey: string,
        envKey?: string,
        min?: number,
        max?: number
    ): number {
        const val = this.resolve<unknown>(cliKey, envKey)
        if (val === undefined || val === null) {
            throw new ConfigurationError(`Missing required numeric configuration for ${cliKey}`)
        }

        const valStr = typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean' ? String(val) : JSON.stringify(val)
        const parsed = typeof val === 'number' ? val : parseInt(valStr, 10)
        
        if (Number.isNaN(parsed)) {
            throw new ConfigurationError(`Invalid required numeric configuration for ${cliKey}: ${valStr}`)
        }
        if (min !== undefined && parsed < min) {
            throw new ConfigurationError(`Configuration ${cliKey} must be at least ${min}`)
        }
        if (max !== undefined && parsed > max) {
            throw new ConfigurationError(`Configuration ${cliKey} must be at most ${max}`)
        }
        
        return parsed
    }

    /**
     * Helper to resolve boolean value
     */
    public resolveBool(
        cliKey: string,
        envKey?: string
    ): boolean | undefined {
        const val = this.resolve<unknown>(cliKey, envKey)
        if (val === undefined) return undefined
        
        if (typeof val === 'boolean') return val
        if (typeof val === 'string') return val.toLowerCase() === 'true'
        return Boolean(val)
    }

    /**
     * Helper to resolve a string array (e.g. from comma separated string or actual array)
     */
    public resolveStringArray(
        cliKey: string,
        envKey?: string
    ): string[] | undefined {
        const val = this.resolve<unknown>(cliKey, envKey)
        if (val === undefined || val === '') return undefined

        if (Array.isArray(val)) {
            return val.map(String).map(s => s.trim()).filter(Boolean)
        }
        
        if (typeof val === 'string') {
            return val.split(',').map(s => s.trim()).filter(Boolean)
        }

        return [typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean' ? String(val) : JSON.stringify(val)]
    }
}
