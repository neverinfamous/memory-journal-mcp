import * as fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { logger } from './logger.js'
import { parseToolFilter } from '../filtering/tool-filter.js'
import { activeProjectRegistry, pairStoredScope } from './write-scope.js'
import {
    applyReloadedBriefingScope,
    buildInitialBaselines,
    reloadBriefingConfigKeys,
    type BriefingBaselineMap,
    type ConfigCliEnvBaseline,
    type DynamicConfig,
} from './config-manager-helpers.js'

export type { ConfigCliEnvBaseline, DynamicConfig }

/** Delay before a config-file change is reloaded, so bursts of writes collapse into one reload. */
const CONFIG_RELOAD_DEBOUNCE_MS = 500

export class ConfigManager extends EventEmitter {
    private config: DynamicConfig
    private readonly initialCodemodeFullAccess: boolean
    private readonly codemodeBaseline: boolean | undefined
    private readonly cliEnvBaseline: ConfigCliEnvBaseline
    private readonly initialBriefingBaseline: BriefingBaselineMap
    private configFilePath?: string | undefined
    private watcher: fs.FSWatcher | undefined
    private debounceTimer?: ReturnType<typeof setTimeout>
    private isWriting = false
    private closed = false
    /** True when the current rawToolFilter originated from the config file (not CLI/env). */
    private toolFilterFromFile = false

    constructor(
        initialConfig: DynamicConfig,
        configFilePath?: string,
        cliEnvBaseline?: ConfigCliEnvBaseline
    ) {
        super()
        this.config = { ...initialConfig }
        this.initialCodemodeFullAccess = Boolean(initialConfig.codemodeInternalFullAccess)
        this.configFilePath = configFilePath

        const initialFile =
            configFilePath !== undefined && fs.existsSync(configFilePath)
                ? this.readRawConfigObject()
                : null
        const baselines = buildInitialBaselines(initialConfig, initialFile, cliEnvBaseline)
        this.cliEnvBaseline = baselines.cliEnvBaseline
        this.toolFilterFromFile = baselines.toolFilterFromFile
        this.codemodeBaseline = baselines.codemodeBaseline
        this.initialBriefingBaseline = baselines.initialBriefingBaseline

        if (this.configFilePath && fs.existsSync(this.configFilePath)) {
            this.watchFile()
        }
    }

    private isYamlConfigPath(): boolean {
        return this.configFilePath !== undefined && /\.ya?ml$/i.test(this.configFilePath)
    }

    private readRawConfigObject(): Record<string, unknown> | null {
        if (!this.configFilePath || !fs.existsSync(this.configFilePath)) return null
        try {
            const content = fs.readFileSync(this.configFilePath, 'utf-8')
            const raw: unknown = this.isYamlConfigPath()
                ? (parseYaml as (text: string) => unknown)(content)
                : JSON.parse(content)
            if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
                return null
            }
            return raw as Record<string, unknown>
        } catch {
            return null
        }
    }

    public getConfig(): DynamicConfig {
        return this.config
    }

    public getConfigFilePath(): string | undefined {
        return this.configFilePath
    }

    /**
     * Fill missing scope defaults from `ServerOptions` for in-memory `ConfigManager` instances
     * (when no config file is watched/reloaded, preserving C9 file hot-reload clearing).
     */
    public seedMissingScopeDefaults(defaults: ConfigCliEnvBaseline): void {
        if (this.configFilePath !== undefined) return
        const bc = { ...this.config.briefingConfig }
        let changed = false
        if (bc.defaultProjectNumber === undefined && defaults.defaultProjectNumber !== undefined) {
            bc.defaultProjectNumber = defaults.defaultProjectNumber
            this.cliEnvBaseline.defaultProjectNumber ??= defaults.defaultProjectNumber
            changed = true
        }
        if (bc.defaultWorkspaceId === undefined && defaults.defaultWorkspaceId !== undefined) {
            bc.defaultWorkspaceId = defaults.defaultWorkspaceId
            this.cliEnvBaseline.defaultWorkspaceId ??= defaults.defaultWorkspaceId
            changed = true
        }
        if (bc.projectRegistry === undefined && defaults.projectRegistry !== undefined) {
            bc.projectRegistry = defaults.projectRegistry
            this.cliEnvBaseline.projectRegistry ??= defaults.projectRegistry
            changed = true
        }
        if (changed) {
            this.config = { ...this.config, briefingConfig: bc }
        }
    }

    /**
     * Apply a config update. When `persist` is set and a config file is in use, the change is
     * also written to disk; the returned string is the write error, or undefined on success.
     */
    public updateConfig(newConfig: Partial<DynamicConfig>, persist = false): string | undefined {
        let nextConfig: DynamicConfig = { ...this.config, ...newConfig }
        if ('rawToolFilter' in newConfig) {
            nextConfig.toolFilterConfig = newConfig.rawToolFilter
                ? parseToolFilter(newConfig.rawToolFilter)
                : null
        }
        if ('briefingConfig' in newConfig) {
            const registry = activeProjectRegistry(nextConfig.briefingConfig.projectRegistry)
            const paired = pairStoredScope(
                nextConfig.briefingConfig.defaultWorkspaceId,
                nextConfig.briefingConfig.defaultProjectNumber,
                registry
            )
            const nextBc = { ...nextConfig.briefingConfig }
            if (paired.workspaceId !== undefined) {
                nextBc.defaultWorkspaceId = paired.workspaceId
            } else {
                delete nextBc.defaultWorkspaceId
            }
            if (typeof paired.projectNumber === 'number') {
                nextBc.defaultProjectNumber = paired.projectNumber
            } else {
                delete nextBc.defaultProjectNumber
            }
            nextConfig = { ...nextConfig, briefingConfig: nextBc }
        }
        this.config = nextConfig

        const persistError = persist && this.configFilePath ? this.persistToFile() : undefined

        this.emit('changed', this.config)
        return persistError
    }

    public close(): void {
        this.closed = true
        if (this.debounceTimer !== undefined) {
            clearTimeout(this.debounceTimer)
            this.debounceTimer = undefined
        }
        this.watcher?.close()
        this.watcher = undefined
    }

    private persistToFile(): string | undefined {
        if (!this.configFilePath) return undefined
        this.isWriting = true
        try {
            const content = fs.readFileSync(this.configFilePath, 'utf-8')
            const isYaml = this.isYamlConfigPath()
            const rawParsed: unknown = isYaml
                ? (parseYaml as (text: string) => unknown)(content)
                : JSON.parse(content)
            if (typeof rawParsed !== 'object' || rawParsed === null || Array.isArray(rawParsed)) {
                throw new Error('Configuration file root must be a JSON/YAML object')
            }
            const parsed = rawParsed as Record<string, unknown>

            // Update keys

            if (this.config.rawToolFilter !== undefined && this.config.rawToolFilter.trim() !== '') {
                parsed['toolFilter'] = this.config.rawToolFilter
                this.toolFilterFromFile = true
            } else {
                delete parsed['toolFilter']
                this.toolFilterFromFile = false
            }
            if (this.config.codemodeInternalFullAccess !== undefined) {
                parsed['codemodeInternalFullAccess'] = this.config.codemodeInternalFullAccess
            }
            if (this.config.briefingConfig.entryCount !== undefined) parsed['briefingEntries'] = this.config.briefingConfig.entryCount
            if (this.config.briefingConfig.summaryCount !== undefined) parsed['briefingSummaries'] = this.config.briefingConfig.summaryCount
            if (this.config.briefingConfig.includeTeam !== undefined) parsed['briefingIncludeTeam'] = this.config.briefingConfig.includeTeam
            if (this.config.briefingConfig.issueCount !== undefined) parsed['briefingIssues'] = this.config.briefingConfig.issueCount
            if (this.config.briefingConfig.prCount !== undefined) parsed['briefingPrs'] = this.config.briefingConfig.prCount
            if (this.config.briefingConfig.prStatusBreakdown !== undefined) parsed['briefingPrStatus'] = this.config.briefingConfig.prStatusBreakdown
            if (this.config.briefingConfig.milestoneCount !== undefined) parsed['briefingMilestones'] = this.config.briefingConfig.milestoneCount
            if (this.config.briefingConfig.workflowCount !== undefined) parsed['briefingWorkflows'] = this.config.briefingConfig.workflowCount
            if (this.config.briefingConfig.workflowStatusBreakdown !== undefined) parsed['briefingWorkflowStatus'] = this.config.briefingConfig.workflowStatusBreakdown
            if (this.config.briefingConfig.copilotReviews !== undefined) parsed['briefingCopilot'] = this.config.briefingConfig.copilotReviews
            if (this.config.briefingConfig.defaultWorkspaceId !== undefined) {
                parsed['defaultWorkspaceId'] = this.config.briefingConfig.defaultWorkspaceId
            } else {
                delete parsed['defaultWorkspaceId']
            }
            if (this.config.briefingConfig.defaultProjectNumber !== undefined) {
                parsed['defaultProjectNumber'] = this.config.briefingConfig.defaultProjectNumber
            } else {
                delete parsed['defaultProjectNumber']
            }

            let serialized: string
            if (!isYaml) {
                serialized = JSON.stringify(parsed, null, 2)
            } else {
                // To avoid destroying yaml comments, ideally we'd use a robust yaml editor.
                // But this is just a best effort fallback for CLI config rewrites.
                logger.warning('YAML file updates from update_configuration tool will drop comments.', { module: 'ConfigManager' })
                serialized = (stringifyYaml as (value: unknown) => string)(parsed)
            }
            // [INVARIANT] Atomic temp+rename so a crash or concurrent reader never sees a truncated config.
            const tmpPath = `${this.configFilePath}.${String(process.pid)}.${String(Date.now())}.tmp`
            try {
                fs.writeFileSync(tmpPath, serialized, 'utf-8')
                fs.renameSync(tmpPath, this.configFilePath)
            } catch (writeErr: unknown) {
                try {
                    fs.rmSync(tmpPath, { force: true })
                } catch {
                    // [SIDE-EFFECT] Best-effort temp cleanup; the original error is reported below.
                }
                throw writeErr
            }
            // [SIDE-EFFECT] rename replaces the inode, so re-arm the watcher on the new file.
            if (!this.closed && this.watcher !== undefined) {
                this.watcher.close()
                this.watcher = undefined
                this.watchFile()
            }
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e)
            logger.error('Failed to persist configuration to file', { module: 'ConfigManager', error: message })
            return message
        } finally {
            this.isWriting = false
        }
        return undefined
    }

    private watchFile(): void {
        if (this.closed || !this.configFilePath) return

        try {
            this.watcher = fs.watch(this.configFilePath, { persistent: false }, (eventType) => {
                if ((eventType === 'change' || eventType === 'rename') && !this.isWriting && !this.closed) {
                    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer)
                    this.debounceTimer = setTimeout(() => {
                        if (this.closed) return
                        try {
                            if (
                                eventType === 'rename' &&
                                this.watcher !== undefined &&
                                this.configFilePath !== undefined &&
                                fs.existsSync(this.configFilePath)
                            ) {
                                this.watcher.close()
                                this.watcher = undefined
                                this.watchFile()
                            }
                            this.reloadFromFile()
                        } catch (err: unknown) {
                            logger.error('Failed to reload config file', { module: 'ConfigManager', error: err instanceof Error ? err.message : String(err) })
                        }
                    }, CONFIG_RELOAD_DEBOUNCE_MS)
                    this.debounceTimer.unref()
                }
            })
            this.watcher.on('error', (err: unknown) => {
                logger.warning('Config file watcher error', {
                    module: 'ConfigManager',
                    path: this.configFilePath,
                    error: err instanceof Error ? err.message : String(err),
                })
            })
            logger.info('Watching configuration file for changes', { module: 'ConfigManager', path: this.configFilePath })
        } catch (error: unknown) {
            logger.warning('Failed to start configuration file watcher', { module: 'ConfigManager', error: error instanceof Error ? error.message : String(error) })
        }
    }

    private reloadFromFile(): void {
        if (!this.configFilePath || !fs.existsSync(this.configFilePath)) return

        try {
            const parsed = this.readRawConfigObject()
            if (parsed === null) {
                throw new Error('Configuration file root must be a JSON/YAML object')
            }

            const updates: Partial<DynamicConfig> = {}
            if ('toolFilter' in parsed) {
                const rawFilter = parsed['toolFilter']
                const fileFilter =
                    typeof rawFilter === 'string' && rawFilter.trim() !== ''
                        ? rawFilter
                        : undefined
                if (fileFilter !== undefined) {
                    updates.rawToolFilter = fileFilter
                    this.toolFilterFromFile = true
                } else if (this.toolFilterFromFile) {
                    updates.rawToolFilter = this.cliEnvBaseline.rawToolFilter
                    this.toolFilterFromFile = false
                }
            } else if (this.toolFilterFromFile) {
                // Key was removed from the file: revert to CLI/env baseline (never clobbering CLI/env).
                updates.rawToolFilter = this.cliEnvBaseline.rawToolFilter
                this.toolFilterFromFile = false
            }
            if (
                'codemodeInternalFullAccess' in parsed &&
                parsed['codemodeInternalFullAccess'] !== null &&
                parsed['codemodeInternalFullAccess'] !== undefined
            ) {
                const requested =
                    typeof parsed['codemodeInternalFullAccess'] === 'boolean'
                        ? parsed['codemodeInternalFullAccess']
                        : undefined
                if (requested === false || (requested === true && this.initialCodemodeFullAccess)) {
                    updates.codemodeInternalFullAccess = requested
                }
            } else if (this.config.codemodeInternalFullAccess !== this.codemodeBaseline) {
                updates.codemodeInternalFullAccess = this.codemodeBaseline
            }

            const bc = { ...this.config.briefingConfig }
            let bcChanged = reloadBriefingConfigKeys(parsed, bc, this.initialBriefingBaseline)
            bcChanged = applyReloadedBriefingScope(parsed, bc, this.cliEnvBaseline) || bcChanged

            if (bcChanged) {
                updates.briefingConfig = bc
            }

            if (Object.keys(updates).length > 0) {
                this.updateConfig(updates, false) // false = don't persist back, we just read it!
                logger.info('Hot-reloaded dynamic configuration from file', { module: 'ConfigManager' })
            }
        } catch (e: unknown) {
            logger.error('Error hot-reloading config file', {
                module: 'ConfigManager',
                error: e instanceof Error ? e.message : String(e),
            })
        }
    }
}
