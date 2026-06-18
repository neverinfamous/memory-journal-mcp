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
}

export class ConfigManager extends EventEmitter {
    private config: DynamicConfig
    private configFilePath?: string
    private watcher?: fs.FSWatcher

    constructor(initialConfig: DynamicConfig, configFilePath?: string) {
        super()
        this.config = { ...initialConfig }
        this.configFilePath = configFilePath

        if (this.configFilePath && fs.existsSync(this.configFilePath)) {
            this.watchFile()
        }
    }

    public getConfig(): DynamicConfig {
        return this.config
    }

    public updateConfig(newConfig: Partial<DynamicConfig>, persist = false): void {
        this.config = { ...this.config, ...newConfig }
        if (newConfig.rawToolFilter !== undefined) {
            this.config.toolFilterConfig = newConfig.rawToolFilter ? parseToolFilter(newConfig.rawToolFilter) : null
        }
        
        if (persist && this.configFilePath) {
            this.persistToFile()
        }
        
        this.emit('changed', this.config)
    }

    public close(): void {
        this.watcher?.close()
    }

    private persistToFile(): void {
        if (!this.configFilePath) return
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
            logger.error('Failed to persist configuration to file', { module: 'ConfigManager', error: e instanceof Error ? e.message : String(e) })
        }
    }

    private watchFile(): void {
        if (!this.configFilePath) return
        
        let debounceTimer: NodeJS.Timeout
        const isWriting = false

        try {
            this.watcher = fs.watch(this.configFilePath, (eventType) => {
                if (eventType === 'change' && !isWriting) {
                    clearTimeout(debounceTimer)
                    debounceTimer = setTimeout(() => {
                        try {
                            this.reloadFromFile()
                        } catch (err: unknown) {
                            logger.error('Failed to reload config file', { module: 'ConfigManager', error: err instanceof Error ? err.message : String(err) })
                        }
                    }, 500)
                }
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

            // Update briefing config if present
            const bc = { ...this.config.briefingConfig }
            let bcChanged = false
            const bcKeys = ['briefingEntries', 'briefingSummaries', 'briefingIncludeTeam', 'briefingIssues', 'briefingPrs', 'briefingPrStatus', 'briefingMilestones', 'briefingWorkflows', 'briefingWorkflowStatus', 'briefingCopilot']
            for (const key of bcKeys) {
                if (key in parsed) {
                    const mappedKey = key === 'briefingEntries' ? 'entryCount' :
                                      key === 'briefingSummaries' ? 'summaryCount' :
                                      key === 'briefingIncludeTeam' ? 'includeTeam' :
                                      key === 'briefingIssues' ? 'issueCount' :
                                      key === 'briefingPrs' ? 'prCount' :
                                      key === 'briefingPrStatus' ? 'prStatusBreakdown' :
                                      key === 'briefingMilestones' ? 'milestoneCount' :
                                      key === 'briefingWorkflows' ? 'workflowCount' :
                                      key === 'briefingWorkflowStatus' ? 'workflowStatusBreakdown' :
                                      key === 'briefingCopilot' ? 'copilotReviews' : undefined;
                    
                    if (mappedKey) {
                        (bc as Record<string, unknown>)[mappedKey] = parsed[key];
                        bcChanged = true;
                    }
                }
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
