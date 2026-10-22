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

/**
 * Extract the configured `project_number` from a registry entry, if present
 */
function getProjectNumber(entry: unknown): number | undefined {
    if (
        typeof entry === 'object' &&
        entry !== null &&
        'project_number' in entry &&
        typeof entry.project_number === 'number'
    ) {
        return entry.project_number
    }
    return undefined
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
                    description: 'Optional comma-separated project names or registry project numbers (e.g., memory-journal-mcp, adamic, 16, 5,16)',
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
                    const activeKey = registryKeys.find(
                        key => getProjectNumber(registry[key]) === briefingConfig.defaultProjectNumber
                    )
                    if (activeKey) {
                        activeWorkspace = `${activeKey} (#${String(briefingConfig.defaultProjectNumber)})`
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

                    // Display the configured project_number (not the list position) so the
                    // number shown matches the registry and what the resolver below accepts
                    const rows = registryKeys.map((key) => {
                        const entry = registry[key] as { path?: string }
                        const projectPath = entry?.path ?? '-'
                        const projectNumber = getProjectNumber(entry)
                        const idCell = projectNumber !== undefined ? String(projectNumber) : '-'
                        return `| ${idCell} | ${key} | ${projectPath} |`
                    }).join('\n')

                    const activeString = activeWorkspace ? `\n**Active**: ${activeWorkspace}\n` : ''

                    return {
                        messages: [
                            {
                                role: 'user',
                                content: {
                                    type: 'text',
                                    text: `## Available Projects\n\n| Project # | Name | Path |\n|---|------|------|\n${rows}\n${activeString}\nAsk the user: "Which project(s) would you like to load? (Enter names or project numbers, separated by commas. Append \`--show\` if you would like me to print the briefing in the chat)"\n\n**Agent Directives:**\n1. Call \`read_resource\` for each selected project using: \`memory://briefing/{name}\`.\n2. If the user included \`--show\`, output the loaded markdown table to them.\n3. If they did NOT include \`--show\`, silently ingest the context and reply simply with: "Context loaded. What would you like to work on?"\n4. When planning something significant, complex, or architecture-impacting, search the memory journal database for historical context. Small or simple tasks do not require this.`,
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

                    // Project number match (registry project_number). Purely numeric input
                    // never falls through to partial name matching (e.g. "2" must not match "R2-...")
                    if (/^\d+$/.test(requested)) {
                        const requestedNumber = Number(requested)
                        const byNumber = registryKeys.find(
                            k => getProjectNumber(registry[k]) === requestedNumber
                        )
                        if (byNumber) {
                            resolvedUris.push(`memory://briefing/${byNumber}`)
                        } else {
                            notFound.push(requested)
                        }
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
                    const availableList = registryKeys.map(k => {
                        const projectNumber = getProjectNumber(registry[k])
                        return projectNumber !== undefined ? `${k} (#${String(projectNumber)})` : k
                    }).join(', ')
                    errorMsg += `\nAvailable projects: ${availableList}\nPlease try again with specific names or project numbers.`
                    
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
                                text: `## Session Briefing Load Instructions\n\nLoad the following project briefing(s) now by calling read_resource for each URI in order:\n\n${uriList}\n\nAfter reading all briefings, present a concise summary of:\n- Active work / recent commits per project\n- Open issues or blockers\n- Any cross-project dependencies\n\nDo NOT skip any of the URIs above.\n\n**Agent Directives:**\n- When planning something significant, complex, or architecture-impacting, search the memory journal database for historical context. Small or simple tasks do not require this.`,
                            },
                        },
                    ],
                }
            },
        },
    ]
}
