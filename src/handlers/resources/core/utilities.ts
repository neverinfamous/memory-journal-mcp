import type { Tag } from '../../../types/index.js'
import {
    ICON_CLOCK,
    ICON_STAR,
    ICON_TAG,
    ICON_ANALYTICS,
    ICON_BRIEFING,
} from '../../../constants/icons.js'
// removed ENTRY_COLUMNS
import {
    withPriority,
    ASSISTANT_FOCUSED,
    LOW_PRIORITY,
    MEDIUM_PRIORITY,
} from '../../../utils/resource-annotations.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../shared.js'
// removed transformEntryRow
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertSafeFilePath, assertSafeDirectoryPath } from '../../../utils/security-utils.js'

export const recentResource: InternalResourceDef = {
    uri: 'memory://recent',
    name: 'Recent Entries',
    title: 'Recent Journal Entries',
    description: '10 most recent journal entries',
    mimeType: 'application/json',
    icons: [ICON_CLOCK],
    annotations: withPriority(0.8, ASSISTANT_FOCUSED),
    handler: (_uri: string, context: ResourceContext): ResourceResult => {
        const entries = context.db.getRecentEntries(10)
        const lastModified = entries[0]?.timestamp ?? new Date().toISOString()
        return {
            data: { entries, count: entries.length },
            annotations: { lastModified },
        }
    },
}

export const significantResource: InternalResourceDef = {
    uri: 'memory://significant',
    name: 'Significant Entries',
    title: 'Significant Milestones',
    description: 'Significant milestones and breakthroughs',
    mimeType: 'application/json',
    icons: [ICON_STAR],
    annotations: withPriority(0.7, ASSISTANT_FOCUSED),
    handler: (_uri: string, context: ResourceContext) => {
        // Importance weights mirror importance.ts constants (significance 0.3, relationships 0.35, causal 0.2, recency 0.15)
        const entries = context.db.getSignificantEntries(100)

        const now = Date.now()
        const MS_PER_DAY = 86_400_000
        const RECENCY_WINDOW_DAYS = 90
        const MAX_REL_SCORE_AT = 5
        const MAX_CAUSAL_SCORE_AT = 3

        const entryIds = entries.map(e => e.id)
        const relationshipsMap = context.db.getRelationshipsForEntries(entryIds)

        const entriesWithImportance = entries.map((entry) => {
            const relationships = relationshipsMap.get(entry.id) ?? []
            const relCount = relationships.length
            const causalCount = relationships.filter(r => ['blocked_by', 'resolved', 'caused'].includes(r.relationshipType)).length
            
            const daysSince = Math.floor(
                (now - new Date(entry.timestamp).getTime()) / MS_PER_DAY
            )
            const recency = Math.max(0, 1 - daysSince / RECENCY_WINDOW_DAYS)

            const importance =
                Math.round(
                    (1.0 * 0.3 + 
                        Math.min(relCount / MAX_REL_SCORE_AT, 1.0) * 0.35 + 
                        Math.min(causalCount / MAX_CAUSAL_SCORE_AT, 1.0) * 0.2 + 
                        recency * 0.15) * 
                        100
                ) / 100

            return { ...entry, importance } as { timestamp: string; importance: number }
        })

        entriesWithImportance.sort((a, b) => {
            if (b.importance !== a.importance) {
                return b.importance - a.importance
            }
            const aTime = new Date(a.timestamp).getTime()
            const bTime = new Date(b.timestamp).getTime()
            return bTime - aTime
        })
        const top20 = entriesWithImportance.slice(0, 20)
        return { entries: top20, count: top20.length }
    },
}

export const tagsResource: InternalResourceDef = {
    uri: 'memory://tags',
    name: 'All Tags',
    title: 'Tag List',
    description: 'All available tags with usage counts',
    mimeType: 'application/json',
    icons: [ICON_TAG],
    annotations: { ...LOW_PRIORITY, audience: ['assistant'] },
    handler: (_uri: string, context: ResourceContext) => {
        const tags: Tag[] = context.db.listTags()
        const mappedTags = tags.map((t) => ({
            id: t.id,
            name: t.name,
            count: t.usageCount,
        }))
        return { tags: mappedTags, count: mappedTags.length }
    },
}

export const statisticsResource: InternalResourceDef = {
    uri: 'memory://statistics',
    name: 'Statistics',
    title: 'Journal Statistics',
    description: 'Overall journal statistics',
    mimeType: 'application/json',
    icons: [ICON_ANALYTICS],
    annotations: { ...LOW_PRIORITY, audience: ['assistant'] },
    handler: (_uri: string, context: ResourceContext) => {
        return context.db.getStatistics('week')
    },
}

interface CachedRuleEntry {
    content: string
    timestamp: number
}
const cachedRulesMap = new Map<string, CachedRuleEntry>()
const RULES_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export const rulesResource: InternalResourceDef = {
    uri: 'memory://rules',
    name: 'Rules File',
    title: 'Agent Rules & Coding Standards',
    description: 'Contents of the configured RULES_FILE_PATH (agent rules / GEMINI.md)',
    mimeType: 'text/markdown',
    icons: [ICON_BRIEFING],
    annotations: withPriority(0.7, ASSISTANT_FOCUSED),
    handler: async (_uri: string, context: ResourceContext): Promise<ResourceResult> => {
        const rulesPath = context.briefingConfig?.rulesFilePath ?? process.env['RULES_FILE_PATH']
        if (!rulesPath) {
            return {
                data: {
                    configured: false,
                    message:
                        'RULES_FILE_PATH is not configured. Set this env var to serve rules content.',
                },
            }
        }
        try {
            const rulesRoot = path.dirname(path.resolve(rulesPath))
            assertSafeFilePath(rulesPath, [rulesRoot])
        } catch (err) {
            return {
                data: {
                    configured: true,
                    error: err instanceof Error ? err.message : String(err),
                },
            }
        }

        try {
            const cached = cachedRulesMap.get(rulesPath)
            if (cached && Date.now() - cached.timestamp < RULES_CACHE_TTL_MS) {
                const stat = await fs.promises
                    .stat(rulesPath)
                    .catch(() => ({ mtimeMs: Date.now() }))
                return {
                    data: cached.content,
                    annotations: {
                        lastModified: new Date(stat.mtimeMs).toISOString(),
                    },
                }
            }

            const stat = await fs.promises.stat(rulesPath)
            if (stat.size > 1024 * 1024) { // 1MB limit for rules
                throw new Error('Rules file exceeds 1MB limit')
            }

            const content = await fs.promises.readFile(rulesPath, 'utf8')
            const mtimeMs = stat.mtimeMs

            cachedRulesMap.set(rulesPath, {
                content,
                timestamp: Date.now()
            })

            // Bounded cache
            if (cachedRulesMap.size > 100) {
                const firstKey = cachedRulesMap.keys().next().value
                if (firstKey) cachedRulesMap.delete(firstKey)
            }

            return {
                data: content,
                annotations: {
                    lastModified: new Date(mtimeMs).toISOString(),
                },
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            return {
                data: {
                    configured: true,
                    error: `Could not read rules file: ${message}`,
                    // Removed configuration path disclosure
                },
            }
        }
    },
}

export const workflowsResource: InternalResourceDef = {
    uri: 'memory://workflows',
    name: 'Workflows',
    title: 'Agent Workflow Summaries',
    description: 'Summary of available agent workflows from the configured workflow directory',
    mimeType: 'application/json',
    icons: [ICON_BRIEFING],
    annotations: { ...MEDIUM_PRIORITY, audience: ['assistant'] },
    handler: (_uri: string, context: ResourceContext): ResourceResult => {
        // Prefer briefingConfig.workflowSummary (set via CLI --workflow-summary or
        // MEMORY_JOURNAL_WORKFLOW_SUMMARY env var in cli.ts). Fall back to env var
        // for callers that don't pass a briefingConfig (e.g., tests, direct readResource).
        const workflowSummary: string | undefined =
            context.briefingConfig?.workflowSummary ??
            process.env['MEMORY_JOURNAL_WORKFLOW_SUMMARY']
        if (workflowSummary === undefined || workflowSummary === '') {
            return {
                data: {
                    configured: false,
                    message:
                        'No workflow summary is available. Set MEMORY_JOURNAL_WORKFLOW_SUMMARY env var or use --workflow-summary.',
                },
            }
        }
        return {
            data: {
                configured: true,
                summary: workflowSummary,
            },
        }
    },
}

interface CachedSkillEntry {
    skills: { name: string; path: string; excerpt: string; source: string }[]
    timestamp: number
}
const cachedSkillsMap = new Map<string, CachedSkillEntry>()
const SKILLS_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/** Resolve the package's own skills/ directory (ships with npm package). */
function getShippedSkillsDir(): string | undefined {
    try {
        const thisFile = fileURLToPath(import.meta.url)
        let dir = path.dirname(thisFile)

        // Find the closest package.json
        while (true) {
            const pkgJsonPath = path.join(dir, 'package.json')
            if (fs.existsSync(pkgJsonPath)) {
                const shipped = path.join(dir, 'skills')
                return fs.existsSync(shipped) ? shipped : undefined
            }

            const parent = path.dirname(dir)
            if (parent === dir) {
                // Reached filesystem root
                break
            }
            dir = parent
        }

        return undefined
    } catch {
        return undefined
    }
}

/** Scan a single skills directory and return skill entries. */
async function scanSkillsDir(
    dir: string,
    source: string
): Promise<{ name: string; path: string; excerpt: string; source: string }[]> {
    if (!fs.existsSync(dir)) return []
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    const skills: { name: string; path: string; excerpt: string; source: string }[] = []

    for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const skillMdPath = path.join(dir, entry.name, 'SKILL.md')
        if (!fs.existsSync(skillMdPath)) continue

        const content = await fs.promises.readFile(skillMdPath, 'utf8')
        // Extract first non-empty non-header line as excerpt (up to 160 chars)
        const lines = content.split('\n')
        const excerptLine = lines.find(
            (l) => l.trim().length > 0 && !l.startsWith('#') && !l.startsWith('---')
        )
        const excerpt = excerptLine ? excerptLine.trim().slice(0, 160) : ''

        skills.push({ name: entry.name, path: skillMdPath, excerpt, source })
    }
    return skills
}

export const skillsResource: InternalResourceDef = {
    uri: 'memory://skills',
    name: 'Skills',
    title: 'Agent Skills Index',
    description: 'Index of available agent skills (shipped + user-configured via SKILLS_DIR_PATH)',
    mimeType: 'application/json',
    icons: [ICON_BRIEFING],
    annotations: { ...MEDIUM_PRIORITY, audience: ['assistant'] },
    handler: async (_uri: string, context: ResourceContext): Promise<ResourceResult> => {
        const userSkillsDir = context.briefingConfig?.skillsDirPath ?? process.env['SKILLS_DIR_PATH']
        const shippedSkillsDir = getShippedSkillsDir()
        const hasAnySource = !!userSkillsDir || !!shippedSkillsDir

        if (userSkillsDir) {
            try {
                const root = path.resolve(userSkillsDir)
                assertSafeDirectoryPath(userSkillsDir, [root])
            } catch (err) {
                return {
                    data: {
                        configured: true,
                        error: err instanceof Error ? err.message : String(err),
                        skills: [],
                        count: 0
                    },
                }
            }
        }

        if (!hasAnySource) {
            return {
                data: {
                    configured: false,
                    message: 'No skills available. Set SKILLS_DIR_PATH to index user skills.',
                },
            }
        }

        try {
            const currentDirs = `${userSkillsDir ?? ''}|${shippedSkillsDir ?? ''}`

            const cached = cachedSkillsMap.get(currentDirs)
            if (
                cached &&
                Date.now() - cached.timestamp < SKILLS_CACHE_TTL_MS
            ) {
                return {
                    data: {
                        configured: true,
                        // Prevent path disclosure of host directories
                        skills: cached.skills.map(s => ({ name: s.name, excerpt: s.excerpt, source: s.source })),
                        count: cached.skills.length,
                    },
                }
            }

            // Scan shipped skills first, then user skills.
            // User skills override shipped skills with the same name.
            const skillMap = new Map<
                string,
                { name: string; path: string; excerpt: string; source: string }
            >()

            if (shippedSkillsDir) {
                for (const skill of await scanSkillsDir(shippedSkillsDir, 'shipped')) {
                    skillMap.set(skill.name, skill)
                }
            }
            if (userSkillsDir) {
                for (const skill of await scanSkillsDir(userSkillsDir, 'user')) {
                    skillMap.set(skill.name, skill) // user overrides shipped
                }
            }

            const skills = [...skillMap.values()].sort((a, b) => a.name.localeCompare(b.name))

            cachedSkillsMap.set(currentDirs, {
                skills,
                timestamp: Date.now()
            })

            // Bounded cache
            if (cachedSkillsMap.size > 100) {
                const firstKey = cachedSkillsMap.keys().next().value
                if (firstKey) cachedSkillsMap.delete(firstKey)
            }

            return {
                data: {
                    configured: true,
                    // Prevent path disclosure of host directories
                    skills: skills.map(s => ({ name: s.name, excerpt: s.excerpt, source: s.source })),
                    count: skills.length,
                },
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            return {
                data: {
                    configured: true,
                    error: `Could not scan skills directory: ${message}`,
                    skills: [],
                    count: 0,
                },
            }
        }
    },
}
