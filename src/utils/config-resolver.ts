import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { parse as parseYaml } from 'yaml'
import type { Command } from 'commander'
import { logger } from './logger.js'
import { ConfigurationError } from '../types/errors.js'

export class ConfigResolver {
    private configFileOptions: Record<string, unknown> = {}
    public loadedConfigPath?: string


    constructor(
        private command: Command,
        private cliOptions: Record<string, unknown>,
        configPathOverride?: string
    ) {
        this.loadEnvFiles()
        this.loadConfigFile(configPathOverride)
    }

    private loadEnvFiles(): void {
        const envPaths = [
            path.resolve(process.cwd(), '.env'),
            path.resolve(process.cwd(), 'secrets.env'),
            path.resolve(os.homedir(), '.gemini', 'config', 'secrets.env'),
            path.resolve(os.homedir(), '.gemini', 'config', '.env'),
        ]

        for (const filePath of envPaths) {
            if (!fs.existsSync(filePath)) continue

            const content = fs.readFileSync(filePath, 'utf-8')
            for (const line of content.split('\n')) {
                const trimmed = line.trim()
                if (!trimmed || trimmed.startsWith('#')) continue
                const idx = trimmed.indexOf('=')
                if (idx <= 0) continue
                const key = trimmed.slice(0, idx).trim()
                const val = trimmed.slice(idx + 1).trim()
                // Highest-priority source wins (OS env > repo .env > repo secrets.env > global ~/.gemini/config/*).
                if (!(key in process.env)) {
                    // Strip surrounding quotes
                    process.env[key] = val.replace(/^["'](.*)["']$/, '$1')
                }
            }
        }
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
                const parsed: unknown = /\.ya?ml$/i.test(filePath)
                    ? parseYaml(content)
                    : JSON.parse(content)
                if (
                    parsed !== null &&
                    parsed !== undefined &&
                    (typeof parsed !== 'object' || Array.isArray(parsed))
                ) {
                    throw new ConfigurationError(
                        `Configuration file ${filePath} must contain a top-level YAML/JSON object`
                    )
                }
                this.configFileOptions = (parsed as Record<string, unknown> | null | undefined) ?? {}
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
                logger.warning('Failed to parse default configuration file; continuing to next candidate', {
                    module: 'ConfigResolver',
                    path: filePath,
                    error: error instanceof Error ? error.message : String(error),
                })
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
        } else {
            const rawEnvVal = envKey !== undefined && envKey !== '' ? process.env[envKey] : undefined
            // 2. Env Var (ignore whitespace-only values so blank env vars do not mask lower layers)
            if (rawEnvVal !== undefined && rawEnvVal.trim() !== '') {
                value = rawEnvVal
                source = 'env'
            }
            // 3. Config File
            else if (
                Object.hasOwn(this.configFileOptions, cliKey) &&
                this.configFileOptions[cliKey] !== undefined
            ) {
                value = this.configFileOptions[cliKey]
                source = 'config'
            }
            // 4. Default from Commander
            else {
                value = this.cliOptions[cliKey]
            }
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

    private _parseNumeric(val: unknown, cliKey: string, min?: number, max?: number, isFloat = false): number {
        if (typeof val !== 'number' && typeof val !== 'string') {
            throw new ConfigurationError(`Invalid numeric configuration for ${cliKey}: ${JSON.stringify(val)}`)
        }
        const rawStr = typeof val === 'number' ? String(val) : val.trim()
        const numericPattern = isFloat
            ? /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i
            : /^-?\d+$/
        if (rawStr === '' || !numericPattern.test(rawStr)) {
            throw new ConfigurationError(`Invalid numeric configuration for ${cliKey}: ${rawStr}`)
        }
        const parsed = typeof val === 'number' ? val : Number(rawStr)
        if (!Number.isFinite(parsed) || (!isFloat && !Number.isInteger(parsed))) {
            throw new ConfigurationError(`Invalid numeric configuration for ${cliKey}: ${rawStr}`)
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
        return this._parseNumeric(val, cliKey, min, max, false)
    }

    /**
     * Helper to resolve an optional numeric value
     */
    public resolveInt(
        cliKey: string,
        envKey?: string,
        min?: number,
        max?: number
    ): number | undefined {
        const val = this.resolve<unknown>(cliKey, envKey)
        if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
            return undefined
        }
        return this._parseNumeric(val, cliKey, min, max, false)
    }

    /**
     * Helper to resolve an optional numeric value (supports floats)
     */
    public resolveNumber(
        cliKey: string,
        envKey?: string,
        min?: number,
        max?: number
    ): number | undefined {
        const val = this.resolve<unknown>(cliKey, envKey)
        if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
            return undefined
        }
        return this._parseNumeric(val, cliKey, min, max, true)
    }

    /**
     * Helper to resolve a boolean value
     */
    public resolveBool(
        cliKey: string,
        envKey?: string
    ): boolean | undefined {
        const val = this.resolve<unknown>(cliKey, envKey)
        if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) return undefined
        
        if (typeof val === 'boolean') return val
        if (typeof val === 'string') {
            const normalized = val.trim().toLowerCase()
            if (normalized === 'true' || normalized === '1') return true
            if (normalized === 'false' || normalized === '0') return false
            throw new ConfigurationError(`Invalid boolean configuration value for ${cliKey}: '${val}'`)
        }
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

    /**
     * Checks whether the given CLI key was explicitly passed on the command line (not default/env/config).
     */
    public isCliProvided(cliKey: string): boolean {
        if (typeof this.command?.getOptionValueSource !== 'function') {
            return false
        }
        try {
            return this.command.getOptionValueSource(cliKey) === 'cli'
        } catch {
            return false
        }
    }
}
