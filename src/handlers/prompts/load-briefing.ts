import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef } from './index.js'
import type { BriefingConfig } from '../resources/shared.js'
import * as path from 'node:path'
import * as os from 'node:os'
import { readFileSync, existsSync } from 'node:fs'

/**
 * Fallback to reading the config file if briefingConfig is not provided
 */
function getRegistryFromConfigFallback(): Record<string, unknown> | null {
    try {
        const configPath = path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json')
        if (existsSync(configPath)) {
            const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>
            if ('projectRegistry' in config && config['projectRegistry'] != null) {
                return config['projectRegistry'] as Record<string, unknown>
            }
        }
    } catch {
        // fail silently
    }
    return null
}

export function getLoadBriefingPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'load-briefing',
            description: 'Load one or more project briefings to initialize your session context. Pass project names or leave blank to see the full list and choose interactively.',
            icons: [ICON_PROMPT],
            arguments: [
                {
                    name: 'projects',
                    description: 'Optional comma-separated project names or numbers (e.g., memory-journal-mcp, adamic, 1, 1,5)',
                    required: false,
                },
            ],
            handler: async (
                args: Record<string, string>,
                _db: unknown,
                _teamDb?: unknown,
                _github?: unknown,
                briefingConfig?: BriefingConfig
            ) => {
                await Promise.resolve()

                // 1. Parse arguments
                const projectsArg = args['projects']
                const requestedProjects = projectsArg
                    ? projectsArg.split(',').map((p) => p.trim()).filter(Boolean)
                    : []

                // 2. Load registry
                let registry: Record<string, unknown> = {}
                if (briefingConfig?.projectRegistry) {
                    registry = briefingConfig.projectRegistry
                } else {
                    const fallbackRegistry = getRegistryFromConfigFallback()
                    if (fallbackRegistry) {
                        registry = fallbackRegistry
                    }
                }

                const registryKeys = Object.keys(registry)
                
                // Active workspace detection (from config default or fallback config)
                let activeWorkspace = ''
                if (briefingConfig?.defaultProjectNumber !== undefined) {
                    const activeKey = registryKeys.find(key => {
                        const entry = registry[key] as { project_number?: number } | undefined
                        return entry?.project_number === briefingConfig.defaultProjectNumber
                    })
                    if (activeKey) {
                        const activeEntry = registry[activeKey] as { project_number?: number }
                        activeWorkspace = `${activeKey} (#${String(activeEntry.project_number)})`
                    }
                }

                // 3. Mode A: No arguments provided -> Interactive list
                if (requestedProjects.length === 0) {
                    if (registryKeys.length === 0) {
                        return {
                            messages: [
                                {
                                    role: 'user',
                                    content: {
                                        type: 'text',
                                        text: `No project registry found. Load the default briefing by calling read_resource on: memory://briefing`,
                                    },
                                },
                            ],
                        }
                    }

                    const rows = registryKeys.map((key, index) => {
                        const entry = registry[key] as { project_number?: number; path?: string }
                        const projectNum = entry?.project_number !== undefined ? String(entry.project_number) : '-'
                        const projectPath = entry?.path ?? '-'
                        return `| ${String(index + 1)} | ${key} | ${projectNum} | ${projectPath} |`
                    }).join('\n')

                    const activeString = activeWorkspace ? `\n**Active**: ${activeWorkspace}\n` : ''

                    return {
                        messages: [
                            {
                                role: 'user',
                                content: {
                                    type: 'text',
                                    text: `## Available Projects\n\n| # | Name | Project ID | Path |\n|---|------|------------|------|\n${rows}\n${activeString}\nAsk the user: "Which project(s) would you like to load? Enter names or numbers, separated by commas."\nThen call read_resource for each selected project using: memory://briefing/{name}`,
                                },
                            },
                        ],
                    }
                }

                // 4. Mode B: Arguments provided -> Resolve and return instructions
                const resolvedUris: string[] = []
                const notFound: string[] = []
                const ambiguous: string[] = []

                for (const requested of requestedProjects) {
                    const requestedLower = requested.toLowerCase()
                    
                    // Exact match
                    if (registryKeys.includes(requested)) {
                        resolvedUris.push(`memory://briefing/${requested}`)
                        continue
                    }
                    
                    // Case-insensitive exact match
                    const ciExact = registryKeys.find(k => k.toLowerCase() === requestedLower)
                    if (ciExact) {
                        resolvedUris.push(`memory://briefing/${ciExact}`)
                        continue
                    }

                    // Project number match
                    const byNumber = registryKeys.find(k => {
                        const entry = registry[k] as { project_number?: number } | undefined
                        return entry?.project_number !== undefined && String(entry.project_number) === requested
                    })
                    if (byNumber) {
                        resolvedUris.push(`memory://briefing/${byNumber}`)
                        continue
                    }

                    // Partial match
                    const partialMatches = registryKeys.filter(k => k.toLowerCase().includes(requestedLower))
                    if (partialMatches.length === 1) {
                        // Using explicit string indexing to avoid TypeScript warnings
                        const matchedKey = partialMatches[0]
                        if (typeof matchedKey === 'string') {
                            resolvedUris.push(`memory://briefing/${matchedKey}`)
                        } else {
                            notFound.push(requested)
                        }
                        continue
                    } else if (partialMatches.length > 1) {
                        ambiguous.push(`${requested} (matches: ${partialMatches.join(', ')})`)
                        continue
                    }

                    notFound.push(requested)
                }

                // Handle errors
                if (notFound.length > 0 || ambiguous.length > 0) {
                    let errorMsg = `Error resolving requested projects:\n`
                    if (notFound.length > 0) {
                        errorMsg += `- Not found: ${notFound.join(', ')}\n`
                    }
                    if (ambiguous.length > 0) {
                        errorMsg += `- Ambiguous: ${ambiguous.join(', ')}\n`
                    }
                    errorMsg += `\nAvailable projects: ${registryKeys.join(', ')}\nPlease try again with specific names or numbers.`
                    
                    return {
                        messages: [
                            {
                                role: 'user',
                                content: {
                                    type: 'text',
                                    text: errorMsg,
                                },
                            },
                        ],
                    }
                }

                // Success
                const uriList = resolvedUris.map((uri, index) => `${String(index + 1)}. ${uri}`).join('\n')
                
                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `## Session Briefing Load Instructions\n\nLoad the following project briefing(s) now by calling read_resource for each URI in order:\n\n${uriList}\n\nAfter reading all briefings, present a concise summary of:\n- Active work / recent commits per project\n- Open issues or blockers\n- Any cross-project dependencies\n\nDo NOT skip any of the URIs above.`,
                            },
                        },
                    ],
                }
            },
        },
    ]
}
