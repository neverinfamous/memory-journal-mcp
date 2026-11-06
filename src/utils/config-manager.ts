import * as fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { logger } from './logger.js'
import { parseToolFilter, type ToolFilterConfig } from '../filtering/tool-filter.js'
import type { BriefingConfig } from '../handlers/resources/shared.js'

export interface DynamicConfig {
    rawToolFilter: string | undefined
    toolFilterConfig: ToolFilterConfig | null
    briefingConfig: BriefingConfig
    codemodeInternalFullAccess?: boolean | undefined
}

/** Config-file keys that map onto `BriefingConfig` fields, with the expected value type. */
const BRIEFING_CONFIG_KEY_MAP: Readonly<
    Record<string, { target: string; kind: 'number' | 'boolean' }>
> = {
    briefingEntries: { target: 'entryCount', kind: 'number' },
    briefingSummaries: { target: 'summaryCount', kind: 'number' },
    briefingIncludeTeam: { target: 'includeTeam', kind: 'boolean' },
    briefingIssues: { target: 'issueCount', kind: 'number' },
    briefingPrs: { target: 'prCount', kind: 'number' },
    briefingPrStatus: { target: 'prStatusBreakdown', kind: 'boolean' },
    briefingMilestones: { target: 'milestoneCount', kind: 'number' },
    briefingWorkflows: { target: 'workflowCount', kind: 'number' },
    briefingWorkflowStatus: { target: 'workflowStatusBreakdown', kind: 'boolean' },
    briefingCopilot: { target: 'copilotReviews', kind: 'boolean' },
}

/** Delay before a config-file change is reloaded, so bursts of writes collapse into one reload. */
const CONFIG_RELOAD_DEBOUNCE_MS = 500

export class ConfigManager extends EventEmitter {
    private config: DynamicConfig
    private readonly initialCodemodeFullAccess: boolean
    private configFilePath?: string | undefined
    private watcher?: fs.FSWatcher
    private debounceTimer?: ReturnType<typeof setTimeout>
    private isWriting = false

    constructor(initialConfig: DynamicConfig, configFilePath?: string) {
        super()
        this.config = { ...initialConfig }
        this.initialCodemodeFullAccess = Boolean(initialConfig.codemodeInternalFullAccess)
        this.configFilePath = configFilePath

        if (this.configFilePath && fs.existsSync(this.configFilePath)) {
            this.watchFile()
        }
    }

    public getConfig(): DynamicConfig {
        return this.config
    }

    /**
     * Apply a config update. When `persist` is set and a config file is in use, the change is
     * also written to disk; the returned string is the write error, or undefined on success.
     */
    public updateConfig(newConfig: Partial<DynamicConfig>, persist = false): string | undefined {
        this.config = { ...this.config, ...newConfig }
        if ('rawToolFilter' in newConfig) {
            this.config.toolFilterConfig = newConfig.rawToolFilter ? parseToolFilter(newConfig.rawToolFilter) : null
        }

        const persistError = persist && this.configFilePath ? this.persistToFile() : undefined

        this.emit('changed', this.config)
        return persistError
    }

    public close(): void {
        if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer)
        this.watcher?.close()
    }

    private persistToFile(): string | undefined {
        if (!this.configFilePath) return undefined
        this.isWriting = true
        try {
            const content = fs.readFileSync(this.configFilePath, 'utf-8')
            let parsed: Record<string, unknown> = {}
            if (this.configFilePath.endsWith('.json')) {
                parsed = JSON.parse(content) as Record<string, unknown>
            } else {
                parsed = (parseYaml as (text: string) => Record<string, unknown>)(content) ?? {}
            }

            // Update keys

            if (this.config.rawToolFilter !== undefined) {
                parsed['toolFilter'] = this.config.rawToolFilter
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

            if (this.configFilePath.endsWith('.json')) {
                fs.writeFileSync(this.configFilePath, JSON.stringify(parsed, null, 2), 'utf-8')
            } else {
                // To avoid destroying yaml comments, ideally we'd use a robust yaml editor.
                // But this is just a best effort fallback for CLI config rewrites.
                logger.warning('YAML file updates from update_configuration tool will drop comments.', { module: 'ConfigManager' })
                const yamlStr = (stringifyYaml as (value: unknown) => string)(parsed)
                fs.writeFileSync(this.configFilePath, yamlStr, 'utf-8')
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
        if (!this.configFilePath) return

        try {
            this.watcher = fs.watch(this.configFilePath, { persistent: false }, (eventType) => {
                if (eventType === 'change' && !this.isWriting) {
                    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer)
                    this.debounceTimer = setTimeout(() => {
                        try {
                            this.reloadFromFile()
                        } catch (err: unknown) {
                            logger.error('Failed to reload config file', { module: 'ConfigManager', error: err instanceof Error ? err.message : String(err) })
                        }
                    }, CONFIG_RELOAD_DEBOUNCE_MS)
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
            const content = fs.readFileSync(this.configFilePath, 'utf-8')
            let parsed: Record<string, unknown> = {}
            if (this.configFilePath.endsWith('.json')) {
                parsed = JSON.parse(content) as Record<string, unknown>
            } else {
                parsed = (parseYaml as (text: string) => Record<string, unknown>)(content) ?? {}
            }

            const updates: Partial<DynamicConfig> = {}
            if ('toolFilter' in parsed) {
                updates.rawToolFilter = typeof parsed['toolFilter'] === 'string' ? parsed['toolFilter'] : undefined
            }
            if ('codemodeInternalFullAccess' in parsed) {
                const requested = typeof parsed['codemodeInternalFullAccess'] === 'boolean' ? parsed['codemodeInternalFullAccess'] : undefined
                if (requested === false || (requested === true && this.initialCodemodeFullAccess)) {
                    updates.codemodeInternalFullAccess = requested
                }
            }

            // Update briefing config if present
            const bc = { ...this.config.briefingConfig }
            let bcChanged = false
            for (const [key, mapping] of Object.entries(BRIEFING_CONFIG_KEY_MAP)) {
                if (!(key in parsed)) continue
                const value = parsed[key]
                if (typeof value !== mapping.kind) {
                    logger.warning('Ignoring briefing config value with unexpected type', {
                        module: 'ConfigManager',
                        key,
                        expected: mapping.kind,
                    })
                    continue
                }
                Object.assign(bc, { [mapping.target]: value })
                bcChanged = true
            }

            if (bcChanged) {
                updates.briefingConfig = bc
            }

            if (Object.keys(updates).length > 0) {
                this.updateConfig(updates, false) // false = don't persist back, we just read it!
                logger.info('Hot-reloaded dynamic configuration from file', { module: 'ConfigManager' })
            }
        } catch (e: unknown) {
            logger.error('Error hot-reloading config file', { module: 'ConfigManager', error: e instanceof Error ? e.message : String(e) })
        }
    }
}
