import * as fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { logger } from './logger.js'
import { parseToolFilter } from '../filtering/tool-filter.js'
import { activeProjectRegistry, pairStoredScope } from './write-scope.js'
import { isForbiddenProjectKey } from './project-registry-guards.js'
import {
    applyReloadedBriefingScope,
    BRIEFING_CONFIG_KEY_MAP,
    buildInitialBaselines,
    seedInitialBriefingScopeFromFile,
    reloadBriefingConfigKeys,
    type BriefingBaselineMap,
    type BriefingConfigurableKey,
    type ConfigCliEnvBaseline,
    type DynamicConfig,
    type MutatedConfigFields,
    type UpdateConfigOptions,
} from './config-manager-helpers.js'
import {
    parseRawConfigObjectFromFile,
    persistDynamicConfigToFile,
} from './config-manager-persist.js'

export type {
    BriefingConfigurableKey,
    ConfigCliEnvBaseline,
    DynamicConfig,
    MutatedConfigFields,
    UpdateConfigOptions,
}

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
    private suppressSelfWatchUntil = 0
    private closed = false
    /** True when the current rawToolFilter originated from the config file or was explicitly mutated. */
    private toolFilterFromFile = false
    private codemodeFromFile = false
    private defaultWorkspaceIdFromFile = false
    private defaultProjectNumberFromFile = false
    private readonly briefingKeysFromFile: Set<BriefingConfigurableKey>
    private readonly lastFileBriefingValues: Map<BriefingConfigurableKey, number | boolean>

    constructor(
        initialConfig: DynamicConfig,
        configFilePath?: string,
        cliEnvBaseline?: ConfigCliEnvBaseline,
        explicitBriefingOverrides?: Partial<Record<BriefingConfigurableKey, number | boolean>>
    ) {
        super()
        this.initialCodemodeFullAccess = Boolean(initialConfig.codemodeInternalFullAccess)
        this.configFilePath = configFilePath

        const initialFile =
            configFilePath !== undefined &&
            fs.lstatSync(configFilePath, { throwIfNoEntry: false }) !== undefined
                ? this.readRawConfigObject()
                : null
        const effectiveInitial = seedInitialBriefingScopeFromFile(initialConfig, initialFile)
        this.config = { ...effectiveInitial }
        const baselines = buildInitialBaselines(
            effectiveInitial,
            initialFile,
            cliEnvBaseline,
            explicitBriefingOverrides
        )
        this.cliEnvBaseline = baselines.cliEnvBaseline
        this.toolFilterFromFile = baselines.toolFilterFromFile
        this.codemodeBaseline = baselines.codemodeBaseline
        this.initialBriefingBaseline = baselines.initialBriefingBaseline
        this.briefingKeysFromFile = new Set(baselines.briefingKeysFromFile)
        this.lastFileBriefingValues = new Map(baselines.lastFileBriefingValues)
        this.codemodeFromFile = baselines.codemodeFromFile
        this.defaultWorkspaceIdFromFile = baselines.defaultWorkspaceIdFromFile
        this.defaultProjectNumberFromFile = baselines.defaultProjectNumberFromFile

        if (
            this.configFilePath &&
            fs.lstatSync(this.configFilePath, { throwIfNoEntry: false }) !== undefined
        ) {
            this.watchFile()
        }
    }

    private isYamlConfigPath(): boolean {
        return this.configFilePath !== undefined && /\.ya?ml$/i.test(this.configFilePath)
    }

    private readRawConfigObject(): Record<string, unknown> | null {
        if (!this.configFilePath) return null
        try {
            return parseRawConfigObjectFromFile(this.configFilePath, this.isYamlConfigPath())
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err)
            logger.error('Configuration file could not be parsed', {
                module: 'ConfigManager',
                path: this.configFilePath,
                error: message,
            })
            throw err
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
        const currentBc = this.config.briefingConfig
        const rawWs = defaults.defaultWorkspaceId?.trim()
        const validWs =
            rawWs !== undefined && !isForbiddenProjectKey(rawWs) ? rawWs : undefined
        const setProject =
            currentBc.defaultProjectNumber === undefined && defaults.defaultProjectNumber !== undefined
        const setWorkspace =
            currentBc.defaultWorkspaceId === undefined && validWs !== undefined
        const setRegistry =
            currentBc.projectRegistry === undefined && defaults.projectRegistry !== undefined
        if (!setProject && !setWorkspace && !setRegistry) return

        const bc = { ...currentBc }
        if (setProject) {
            bc.defaultProjectNumber = defaults.defaultProjectNumber
            this.cliEnvBaseline.defaultProjectNumber ??= defaults.defaultProjectNumber
        }
        if (setWorkspace) {
            bc.defaultWorkspaceId = validWs
            this.cliEnvBaseline.defaultWorkspaceId ??= validWs
        }
        if (setRegistry) {
            bc.projectRegistry = defaults.projectRegistry
            this.cliEnvBaseline.projectRegistry ??= defaults.projectRegistry
        }
        this.config = { ...this.config, briefingConfig: bc }
    }

    /**
     * Apply a config update. When `persist` is set and a config file is in use, the change is
     * also written to disk; the returned string is the write error, or undefined on success.
     */
    public updateConfig(
        newConfig: Partial<DynamicConfig>,
        persist = false,
        options?: UpdateConfigOptions
    ): string | undefined {
        const prevConfig = this.config
        let nextConfig: DynamicConfig = { ...this.config, ...newConfig }
        if ('rawToolFilter' in newConfig) {
            const trimmedFilter = newConfig.rawToolFilter?.trim()
            nextConfig.toolFilterConfig =
                trimmedFilter !== undefined && trimmedFilter !== '' ? parseToolFilter(trimmedFilter) : null
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
        const prevProvenance =
            persist && this.configFilePath ? this.snapshotProvenance() : undefined
        if (persist) {
            this.recordPersistableMutations(prevConfig, newConfig, nextConfig, options)
        }
        this.config = nextConfig

        const persistError = persist && this.configFilePath ? this.persistToFile() : undefined
        if (persistError !== undefined && prevProvenance !== undefined) {
            this.restoreProvenance(prevProvenance)
        } else if (persist && this.configFilePath && persistError === undefined) {
            for (const key of this.briefingKeysFromFile) {
                const persistedVal = nextConfig.briefingConfig[key]
                if (persistedVal !== undefined) {
                    this.lastFileBriefingValues.set(key, persistedVal)
                }
            }
        }

        this.emit('changed', this.config)
        return persistError
    }

    private snapshotProvenance(): {
        toolFilterFromFile: boolean
        codemodeFromFile: boolean
        defaultWorkspaceIdFromFile: boolean
        defaultProjectNumberFromFile: boolean
        briefingKeysFromFile: Set<BriefingConfigurableKey>
    } {
        return {
            toolFilterFromFile: this.toolFilterFromFile,
            codemodeFromFile: this.codemodeFromFile,
            defaultWorkspaceIdFromFile: this.defaultWorkspaceIdFromFile,
            defaultProjectNumberFromFile: this.defaultProjectNumberFromFile,
            briefingKeysFromFile: new Set(this.briefingKeysFromFile),
        }
    }

    private restoreProvenance(snapshot: ReturnType<ConfigManager['snapshotProvenance']>): void {
        this.toolFilterFromFile = snapshot.toolFilterFromFile
        this.codemodeFromFile = snapshot.codemodeFromFile
        this.defaultWorkspaceIdFromFile = snapshot.defaultWorkspaceIdFromFile
        this.defaultProjectNumberFromFile = snapshot.defaultProjectNumberFromFile
        this.briefingKeysFromFile.clear()
        for (const key of snapshot.briefingKeysFromFile) {
            this.briefingKeysFromFile.add(key)
        }
    }

    private recordPersistableMutations(
        prevConfig: DynamicConfig,
        newConfig: Partial<DynamicConfig>,
        nextConfig: DynamicConfig,
        options?: UpdateConfigOptions
    ): void {
        const mutated = options?.mutatedFields
        if (mutated !== undefined) {
            if (mutated.rawToolFilter === true) this.toolFilterFromFile = true
            if (mutated.codemodeInternalFullAccess === true) this.codemodeFromFile = true
            if (mutated.defaultWorkspaceId === true) this.defaultWorkspaceIdFromFile = true
            if (mutated.defaultProjectNumber === true) this.defaultProjectNumberFromFile = true
            for (const key of mutated.briefingKeys ?? []) {
                this.briefingKeysFromFile.add(key)
            }
            return
        }
        if ('rawToolFilter' in newConfig) {
            this.toolFilterFromFile = true
        }
        if (
            'codemodeInternalFullAccess' in newConfig &&
            nextConfig.codemodeInternalFullAccess !== prevConfig.codemodeInternalFullAccess
        ) {
            this.codemodeFromFile = true
        }
        if ('briefingConfig' in newConfig) {
            for (const { target } of Object.values(BRIEFING_CONFIG_KEY_MAP)) {
                if (nextConfig.briefingConfig[target] !== prevConfig.briefingConfig[target]) {
                    this.briefingKeysFromFile.add(target)
                }
            }
            if (
                nextConfig.briefingConfig.defaultWorkspaceId !==
                prevConfig.briefingConfig.defaultWorkspaceId
            ) {
                this.defaultWorkspaceIdFromFile = true
            }
            if (
                nextConfig.briefingConfig.defaultProjectNumber !==
                prevConfig.briefingConfig.defaultProjectNumber
            ) {
                this.defaultProjectNumberFromFile = true
            }
        }
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
            persistDynamicConfigToFile(
                this.configFilePath,
                this.isYamlConfigPath(),
                this.config,
                {
                    toolFilter: this.toolFilterFromFile,
                    codemode: this.codemodeFromFile,
                    defaultWorkspaceId: this.defaultWorkspaceIdFromFile,
                    defaultProjectNumber: this.defaultProjectNumberFromFile,
                    briefingKeys: this.briefingKeysFromFile,
                },
                () => {
                    logger.warning('YAML file updates from update_configuration tool will drop comments.', {
                        module: 'ConfigManager',
                    })
                }
            )
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
            this.suppressSelfWatchUntil = Date.now() + 250
            this.isWriting = false
        }
        return undefined
    }

    private runDebouncedReload(state: { pendingRename: boolean }): void {
        if (this.closed) return
        const shouldRewatch = state.pendingRename
        state.pendingRename = false
        try {
            if (
                shouldRewatch &&
                this.watcher !== undefined &&
                this.configFilePath !== undefined &&
                fs.lstatSync(this.configFilePath, { throwIfNoEntry: false }) !== undefined
            ) {
                this.watcher.close()
                this.watcher = undefined
                this.watchFile()
            }
            this.reloadFromFile()
        } catch (err: unknown) {
            logger.error('Failed to reload config file', {
                module: 'ConfigManager',
                error: err instanceof Error ? err.message : String(err),
            })
        }
    }

    private watchFile(): void {
        if (this.closed || !this.configFilePath) return
        try {
            const state = { pendingRename: false }
            this.watcher = fs.watch(this.configFilePath, { persistent: false }, (eventType) => {
                if (
                    (eventType !== 'change' && eventType !== 'rename') ||
                    this.isWriting ||
                    Date.now() < this.suppressSelfWatchUntil ||
                    this.closed
                ) {
                    return
                }
                if (eventType === 'rename') state.pendingRename = true
                if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer)
                this.debounceTimer = setTimeout(() => {
                    this.runDebouncedReload(state)
                }, CONFIG_RELOAD_DEBOUNCE_MS)
                this.debounceTimer.unref()
            })
            this.watcher.on('error', (err: unknown) => {
                logger.warning('Config file watcher error', {
                    module: 'ConfigManager',
                    path: this.configFilePath,
                    error: err instanceof Error ? err.message : String(err),
                })
            })
            logger.info('Watching configuration file for changes', {
                module: 'ConfigManager',
                path: this.configFilePath,
            })
        } catch (error: unknown) {
            logger.warning('Failed to start configuration file watcher', {
                module: 'ConfigManager',
                error: error instanceof Error ? error.message : String(error),
            })
        }
    }

    private applyReloadedToolFilter(
        parsed: Record<string, unknown>,
        updates: Partial<DynamicConfig>
    ): void {
        if ('toolFilter' in parsed) {
            const rawFilter = parsed['toolFilter']
            const fileFilter =
                typeof rawFilter === 'string' && rawFilter.trim() !== '' ? rawFilter : undefined
            if (fileFilter !== undefined) {
                if (fileFilter !== this.config.rawToolFilter) updates.rawToolFilter = fileFilter
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
    }

    private applyReloadedCodemode(
        parsed: Record<string, unknown>,
        updates: Partial<DynamicConfig>
    ): void {
        const rawVal = parsed['codemodeInternalFullAccess']
        if ('codemodeInternalFullAccess' in parsed && rawVal !== null && rawVal !== undefined) {
            const requested = typeof rawVal === 'boolean' ? rawVal : undefined
            if (requested !== undefined) this.codemodeFromFile = true
            if (
                (requested === false || (requested === true && this.initialCodemodeFullAccess)) &&
                requested !== this.config.codemodeInternalFullAccess
            ) {
                updates.codemodeInternalFullAccess = requested
            }
        } else {
            this.codemodeFromFile = false
            if (this.config.codemodeInternalFullAccess !== this.codemodeBaseline) {
                updates.codemodeInternalFullAccess = this.codemodeBaseline
            }
        }
    }

    private reloadFromFile(): void {
        if (
            !this.configFilePath ||
            fs.lstatSync(this.configFilePath, { throwIfNoEntry: false }) === undefined
        ) {
            return
        }

        try {
            const parsed = this.readRawConfigObject()
            if (parsed === null) {
                throw new Error('Configuration file root must be a JSON/YAML object')
            }

            const updates: Partial<DynamicConfig> = {}
            this.applyReloadedToolFilter(parsed, updates)
            this.applyReloadedCodemode(parsed, updates)

            const bc = { ...this.config.briefingConfig }
            const bcKeyChanged = reloadBriefingConfigKeys(
                parsed,
                bc,
                this.initialBriefingBaseline,
                this.briefingKeysFromFile,
                this.lastFileBriefingValues
            )
            const scopeOutcome = applyReloadedBriefingScope(parsed, bc, this.cliEnvBaseline)
            if (scopeOutcome.scopeAccepted) {
                this.defaultWorkspaceIdFromFile = scopeOutcome.defaultWorkspaceIdFromFile
                this.defaultProjectNumberFromFile = scopeOutcome.defaultProjectNumberFromFile
            }

            if (bcKeyChanged || scopeOutcome.changed) {
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
