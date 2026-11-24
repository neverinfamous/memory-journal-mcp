import * as path from 'node:path'
import * as os from 'node:os'
import { parse as parseYaml } from 'yaml'
import { logger } from './logger.js'
import { ConfigurationError } from '../types/errors.js'
import { readSafeRegularConfigTextSync } from './config-file-safety.js'
import { isRecord } from './type-guards.js'

/** Minimal Commander-compatible interface needed by ConfigResolver and CLI helpers. */
export interface CliCommandLike {
    name(): string
    getOptionValueSource(key: string): string | undefined
}

export class ConfigResolver {
    private configFileOptions: Record<string, unknown> = {}
    public loadedConfigPath?: string


    constructor(
        private command: CliCommandLike,
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
            let loaded: ReturnType<typeof readSafeRegularConfigTextSync>
            try {
                loaded = readSafeRegularConfigTextSync(filePath)
            } catch (err) {
                logger.warning('Skipping unsafe or unreadable env file', {
                    module: 'ConfigResolver',
                    path: filePath,
                    error: err instanceof Error ? err.message : String(err),
                })
                continue
            }
            if (loaded === undefined) continue

            const content = loaded.content.replace(/^\uFEFF/, '')
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
                    process.env[key] = val.replace(/^(["'])(.*)\1$/, '$2')
                }
            }
        }
    }

    private loadConfigFile(configPathOverride?: string): void {
        if (configPathOverride?.trim() === '') {
            throw new ConfigurationError('Invalid blank configuration file path.')
        }
        const pathsToTry =
            configPathOverride !== undefined
                ? [path.resolve(configPathOverride.trim())]
                : [
                  path.resolve(process.cwd(), 'memory-journal.config.yaml'),
                  path.resolve(process.cwd(), 'memory-journal.config.yml'),
                  path.resolve(process.cwd(), 'memory-journal.config.json'),
                  path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json'),
                  path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.yaml'),
                  path.resolve(os.homedir(), '.memory-journal', 'config.json'),
              ]

        for (const filePath of pathsToTry) {
            let loaded: ReturnType<typeof readSafeRegularConfigTextSync>
            try {
                loaded = readSafeRegularConfigTextSync(filePath)
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                if (configPathOverride) {
                    throw new ConfigurationError(`Failed to load config file ${filePath}: ${msg}`, {
                        cause: err instanceof Error ? err : undefined,
                    })
                }
                logger.warning('Failed to read configuration file; continuing to next candidate', {
                    module: 'ConfigResolver',
                    path: filePath,
                    error: msg,
                })
                continue
            }
            if (loaded === undefined) {
                if (configPathOverride) {
                    throw new ConfigurationError(`Failed to load config file ${filePath}: File does not exist`)
                }
                continue
            }
            try {
                const content = loaded.content
                const parsed: unknown = /\.ya?ml$/i.test(filePath)
                    ? parseYaml(content)
                    : JSON.parse(content)
                if (parsed === null || parsed === undefined) {
                    this.configFileOptions = {}
                } else if (isRecord(parsed)) {
                    this.configFileOptions = parsed
                } else {
                    throw new ConfigurationError(
                        `Configuration file ${filePath} must contain a top-level YAML/JSON object`
                    )
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
    public resolve(cliKey: string, envKey?: string): unknown
    public resolve<T>(
        cliKey: string,
        envKey: string | undefined,
        parser: (val: unknown) => T
    ): T | undefined
    public resolve<T>(
        cliKey: string,
        envKey?: string,
        parser?: (val: unknown) => T
    ): unknown {
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
            return parser !== undefined ? parser(value) : value
        } catch (err) {
            throw new ConfigurationError(`Failed to parse configuration for ${cliKey} (source: ${source}): ${err instanceof Error ? err.message : String(err)}`, { cause: err instanceof Error ? err : undefined })
        }
    }

    /** Resolve an optional string configuration value, rejecting non-string config values. */
    public resolveString(cliKey: string, envKey?: string): string | undefined {
        const val = this.resolve(cliKey, envKey)
        if (val === undefined || val === null) return undefined
        if (typeof val !== 'string') {
            throw new ConfigurationError(
                `Invalid string configuration for ${cliKey}: expected string, got ${typeof val}`
            )
        }
        return val
    }

    /** Resolve an optional string-or-number configuration value, rejecting other types. */
    public resolveStringOrNumber(cliKey: string, envKey?: string): string | number | undefined {
        const val = this.resolve(cliKey, envKey)
        if (val === undefined || val === null) return undefined
        if (typeof val !== 'string' && typeof val !== 'number') {
            throw new ConfigurationError(
                `Invalid configuration for ${cliKey}: expected string or number, got ${typeof val}`
            )
        }
        return val
    }

    private _parseNumeric(val: unknown, cliKey: string, min?: number, max?: number, isFloat = false): number {
        if (typeof val !== 'number' && typeof val !== 'string') {
            throw new ConfigurationError(`Invalid numeric configuration for ${cliKey}: ${JSON.stringify(val)}`)
        }
        const rawStr = typeof val === 'number' ? String(val) : val.trim()
        const numericPattern = isFloat
            ? /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i
            : /^(?:0|-?[1-9]\d*)$/
        if (rawStr === '' || !numericPattern.test(rawStr)) {
            throw new ConfigurationError(`Invalid numeric configuration for ${cliKey}: ${rawStr}`)
        }
        const parsed = typeof val === 'number' ? val : Number(rawStr)
        if (!Number.isFinite(parsed) || (!isFloat && !Number.isSafeInteger(parsed))) {
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
        const val = this.resolve(cliKey, envKey)
        if (val === undefined || val === null) {
            throw new ConfigurationError(`Missing required numeric configuration for ${cliKey}`)
        }
        return this._parseNumeric(val, cliKey, min, max, false)
    }

    /**
     * Helper to resolve an optional numeric value.
     * [INVARIANT] Explicit blank CLI flags or config-file strings throw `ConfigurationError`
     * instead of silently falling back to defaults.
     */
    public resolveInt(
        cliKey: string,
        envKey?: string,
        min?: number,
        max?: number
    ): number | undefined {
        const val = this.resolve(cliKey, envKey)
        if (val === undefined || val === null) {
            return undefined
        }
        if (typeof val === 'string' && val.trim() === '') {
            if (this.isCliProvided(cliKey) || this.hasConfigFileKey(cliKey)) {
                throw new ConfigurationError(`Invalid blank numeric configuration for ${cliKey}`)
            }
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
        const val = this.resolve(cliKey, envKey)
        if (val === undefined || val === null) {
            return undefined
        }
        if (typeof val === 'string' && val.trim() === '') {
            if (this.isCliProvided(cliKey) || this.hasConfigFileKey(cliKey)) {
                throw new ConfigurationError(`Invalid blank numeric configuration for ${cliKey}`)
            }
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
        const val = this.resolve(cliKey, envKey)
        if (val === undefined || val === null) return undefined
        if (typeof val === 'string' && val.trim() === '') {
            if (this.isCliProvided(cliKey) || this.hasConfigFileKey(cliKey)) {
                throw new ConfigurationError(`Invalid blank boolean configuration for ${cliKey}`)
            }
            return undefined
        }

        if (typeof val === 'boolean') return val
        if (typeof val === 'string') {
            const normalized = val.trim().toLowerCase()
            if (normalized === 'true' || normalized === '1') return true
            if (normalized === 'false' || normalized === '0') return false
            throw new ConfigurationError(`Invalid boolean configuration value for ${cliKey}: '${val}'`)
        }
        throw new ConfigurationError(
            `Invalid boolean configuration value for ${cliKey}: expected boolean or boolean string, got ${typeof val}`
        )
    }

    /**
     * Helper to resolve a string array (e.g. from comma separated string or actual array)
     */
    public resolveStringArray(
        cliKey: string,
        envKey?: string
    ): string[] | undefined {
        const val = this.resolve(cliKey, envKey)
        if (val === undefined || val === null) return undefined

        if (Array.isArray(val)) {
            const items: string[] = []
            for (const item of val) {
                if (item === undefined || item === null) continue
                if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
                    throw new ConfigurationError(
                        `Invalid string-array element for ${cliKey}: expected string, got ${typeof item}`
                    )
                }
                const trimmed = String(item).trim()
                if (trimmed !== '') items.push(trimmed)
            }
            return items.length > 0 ? items : undefined
        }

        if (typeof val === 'string') {
            const parts = val.split(',').map((s) => s.trim()).filter(Boolean)
            return parts.length > 0 ? parts : undefined
        }

        throw new ConfigurationError(
            `Invalid string-array configuration for ${cliKey}: expected array or comma-separated string, got ${typeof val}`
        )
    }

    /**
     * True when the loaded config file defines `key` with a non-null value (ignores CLI/env/defaults).
     */
    public hasConfigFileKey(key: string): boolean {
        return (
            Object.hasOwn(this.configFileOptions, key) &&
            this.configFileOptions[key] !== undefined &&
            this.configFileOptions[key] !== null
        )
    }

    /**
     * Checks whether the given CLI key was explicitly passed on the command line (not default/env/config).
     */
    public isCliProvided(cliKey: string): boolean {
        if (typeof this.command?.getOptionValueSource !== 'function') {
            return false
        }
        if (!Object.hasOwn(this.cliOptions, cliKey) || this.cliOptions[cliKey] === undefined) {
            return false
        }
        try {
            return this.command.getOptionValueSource(cliKey) === 'cli'
        } catch {
            return false
        }
    }
}
