import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef, PromptMessage } from './index.js'
import { resourceWorkspace, type BriefingConfig } from '../resources/shared.js'
import {
    loadProjectRegistryFromConfig,
    setActiveSessionProject,
} from '../../utils/workspace-resolver.js'

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

function buildInteractiveProjectListResponse(
    registry: Record<string, unknown>,
    registryKeys: string[],
    activeWorkspace: string
): { messages: PromptMessage[] } {
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

    const rows = registryKeys
        .map((key) => {
            const entry = registry[key] as { path?: string }
            const projectPath = entry?.path ?? '-'
            const projectNumber = getProjectNumber(entry)
            const idCell = projectNumber !== undefined ? String(projectNumber) : '-'
            return `| ${idCell} | ${key} | ${projectPath} |`
        })
        .join('\n')

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

function resolveRequestedProjectUris(
    requestedProjects: string[],
    registry: Record<string, unknown>,
    registryKeys: string[]
): { resolvedUris: string[]; notFound: string[]; ambiguous: string[] } {
    const resolvedUris: string[] = []
    const notFound: string[] = []
    const ambiguous: string[] = []

    for (const requested of requestedProjects) {
        const requestedLower = requested.toLowerCase()

        if (registryKeys.includes(requested)) {
            resolvedUris.push(`memory://briefing/${requested}`)
            continue
        }

        const ciExact = registryKeys.find((k) => k.toLowerCase() === requestedLower)
        if (ciExact) {
            resolvedUris.push(`memory://briefing/${ciExact}`)
            continue
        }

        if (/^\d+$/.test(requested)) {
            const requestedNumber = Number(requested)
            const byNumber = registryKeys.filter(
                (k) => getProjectNumber(registry[k]) === requestedNumber
            )
            if (byNumber.length === 1) {
                const matchedKey = byNumber[0]
                if (matchedKey !== undefined) {
                    resolvedUris.push(`memory://briefing/${matchedKey}`)
                }
            } else if (byNumber.length > 1) {
                ambiguous.push(`${requested} (matches: ${byNumber.join(', ')})`)
            } else {
                notFound.push(requested)
            }
            continue
        }

        const partialMatches = registryKeys.filter((k) =>
            k.toLowerCase().includes(requestedLower)
        )
        if (partialMatches.length > 1) {
            ambiguous.push(`${requested} (matches: ${partialMatches.join(', ')})`)
            continue
        }

        notFound.push(requested)
    }

    return { resolvedUris, notFound, ambiguous }
}

export function getLoadBriefingPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'load-briefing',
            description:
                'Load one or more project briefings to initialize your session context. Pass project names or leave blank to see the full list and choose interactively.',
            icons: [ICON_PROMPT],
            arguments: [
                {
                    name: 'projects',
                    description:
                        'Optional comma-separated project names or registry project numbers (e.g., memory-journal-mcp, adamic, 16, 5,16)',
                    required: false,
                },
            ],
            handler: (
                args: Record<string, string>,
                _db: unknown,
                _teamDb?: unknown,
                _github?: unknown,
                briefingConfig?: BriefingConfig,
                runtime?: object | null
            ) => {
                const projectsArg = args['projects']
                const requestedProjects = projectsArg
                    ? projectsArg
                          .split(',')
                          .map((p) => p.trim())
                          .filter(Boolean)
                    : []

                const registry: Record<string, unknown> =
                    briefingConfig?.projectRegistry ?? loadProjectRegistryFromConfig() ?? {}
                const registryKeys = Object.keys(registry)

                let activeWorkspace = ''
                if (briefingConfig?.defaultProjectNumber !== undefined) {
                    const activeKey = registryKeys.find(
                        (key) =>
                            getProjectNumber(registry[key]) === briefingConfig.defaultProjectNumber
                    )
                    if (activeKey) {
                        activeWorkspace = `${activeKey} (#${String(briefingConfig.defaultProjectNumber)})`
                    }
                } else {
                    const resolvedWs = resourceWorkspace({
                        briefingConfig: {
                            ...briefingConfig,
                            projectRegistry: registry as BriefingConfig['projectRegistry'],
                        },
                        ...(runtime !== undefined ? { runtime } : {}),
                    })
                    if (resolvedWs && resolvedWs !== 'default') {
                        const projNum = getProjectNumber(registry[resolvedWs])
                        activeWorkspace =
                            projNum !== undefined
                                ? `${resolvedWs} (#${String(projNum)})`
                                : resolvedWs
                    }
                }

                if (requestedProjects.length === 0) {
                    return buildInteractiveProjectListResponse(
                        registry,
                        registryKeys,
                        activeWorkspace
                    )
                }

                const { resolvedUris, notFound, ambiguous } = resolveRequestedProjectUris(
                    requestedProjects,
                    registry,
                    registryKeys
                )

                if (notFound.length > 0 || ambiguous.length > 0) {
                    let errorMsg = `Error resolving requested projects:\n`
                    if (notFound.length > 0) {
                        errorMsg += `- Not found: ${notFound.join(', ')}\n`
                    }
                    if (ambiguous.length > 0) {
                        errorMsg += `- Ambiguous: ${ambiguous.join(', ')}\n`
                    }
                    const availableList = registryKeys
                        .map((k) => {
                            const projectNumber = getProjectNumber(registry[k])
                            return projectNumber !== undefined
                                ? `${k} (#${String(projectNumber)})`
                                : k
                        })
                        .join(', ')
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

                const firstResolvedUri = resolvedUris[0]
                if (firstResolvedUri?.startsWith('memory://briefing/')) {
                    const primaryKey = firstResolvedUri.slice('memory://briefing/'.length)
                    if (primaryKey.length > 0) {
                        const primaryProjNum = getProjectNumber(registry[primaryKey])
                        setActiveSessionProject(primaryKey, primaryProjNum, runtime)
                    }
                }

                const uriList = resolvedUris
                    .map((uri, index) => `${String(index + 1)}. ${uri}`)
                    .join('\n')

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
