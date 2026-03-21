import type { Tag } from '../../../types/index.js'
import { ICON_CLOCK, ICON_STAR, ICON_TAG, ICON_ANALYTICS, ICON_BRIEFING } from '../../../constants/icons.js'
import { RAW_ENTRY_COLUMNS as ENTRY_COLUMNS } from '../../../database/core/entry-columns.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../shared.js'
import { execQuery, transformEntryRow } from '../shared.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

export const recentResource: InternalResourceDef = {
    uri: 'memory://recent',
    name: 'Recent Entries',
    title: 'Recent Journal Entries',
    description: '10 most recent journal entries',
    mimeType: 'application/json',
    icons: [ICON_CLOCK],
    annotations: {
        audience: ['assistant'],
        priority: 0.8,
    },
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
    annotations: {
        audience: ['assistant'],
        priority: 0.7,
    },
    handler: (_uri: string, context: ResourceContext) => {
        const rows = execQuery(
            context.db,
            `
            SELECT ${ENTRY_COLUMNS} FROM memory_journal
            WHERE significance_type IS NOT NULL
            AND deleted_at IS NULL
        `
        )
        const entriesWithImportance: (Record<string, unknown> & { importance: number })[] =
            rows.map((row) => {
                const entry = transformEntryRow(row)
                const { score: importance } = context.db.calculateImportance(entry['id'] as number)
                return { ...entry, importance }
            })
        entriesWithImportance.sort((a, b) => {
            if (b.importance !== a.importance) {
                return b.importance - a.importance
            }
            const aTime = new Date(a['timestamp'] as string).getTime()
            const bTime = new Date(b['timestamp'] as string).getTime()
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
    annotations: {
        audience: ['assistant'],
        priority: 0.4,
    },
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
    annotations: {
        audience: ['assistant'],
        priority: 0.4,
    },
    handler: (_uri: string, context: ResourceContext) => {
        return context.db.getStatistics('week')
    },
}

export const rulesResource: InternalResourceDef = {
    uri: 'memory://rules',
    name: 'Rules File',
    title: 'Agent Rules & Coding Standards',
    description: 'Contents of the configured RULES_FILE_PATH (agent rules / GEMINI.md)',
    mimeType: 'text/markdown',
    icons: [ICON_BRIEFING],
    annotations: {
        audience: ['assistant'],
        priority: 0.7,
    },
    handler: (_uri: string, _context: ResourceContext): ResourceResult => {
        const rulesPath = process.env['RULES_FILE_PATH']
        if (!rulesPath) {
            return {
                data: {
                    configured: false,
                    message: 'RULES_FILE_PATH is not configured. Set this env var to serve rules content.',
                },
            }
        }
        try {
            const content = fs.readFileSync(rulesPath, 'utf8')
            return {
                data: content,
                annotations: { lastModified: new Date(fs.statSync(rulesPath).mtimeMs).toISOString() },
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            return {
                data: {
                    configured: true,
                    error: `Could not read rules file: ${message}`,
                    path: rulesPath,
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
    annotations: {
        audience: ['assistant'],
        priority: 0.6,
    },
    handler: (_uri: string, _context: ResourceContext): ResourceResult => {
        // workflowSummary is not yet part of BriefingConfig — surfaced via env var
        const workflowSummary: string | undefined = process.env['MEMORY_JOURNAL_WORKFLOW_SUMMARY']
        if (workflowSummary === undefined || workflowSummary === '') {
            return {
                data: {
                    configured: false,
                    message:
                        'No workflow summary is available. Set MEMORY_JOURNAL_WORKFLOW_SUMMARY env var.',
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

export const skillsResource: InternalResourceDef = {
    uri: 'memory://skills',
    name: 'Skills',
    title: 'Agent Skills Index',
    description: 'Index of available agent skills from the configured SKILLS_DIR_PATH',
    mimeType: 'application/json',
    icons: [ICON_BRIEFING],
    annotations: {
        audience: ['assistant'],
        priority: 0.6,
    },
    handler: (_uri: string, _context: ResourceContext): ResourceResult => {
        const skillsDir = process.env['SKILLS_DIR_PATH']
        if (!skillsDir) {
            return {
                data: {
                    configured: false,
                    message: 'SKILLS_DIR_PATH is not configured. Set this env var to index skills.',
                },
            }
        }
        try {
            if (!fs.existsSync(skillsDir)) {
                return {
                    data: {
                        configured: true,
                        error: `Skills directory not found: ${skillsDir}`,
                        skills: [],
                        count: 0,
                    },
                }
            }

            // Find all SKILL.md files one level deep (each skill is a directory)
            const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
            const skills: { name: string; path: string; excerpt: string }[] = []

            for (const entry of entries) {
                if (!entry.isDirectory()) continue
                const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md')
                if (!fs.existsSync(skillMdPath)) continue

                const content = fs.readFileSync(skillMdPath, 'utf8')
                // Extract first non-empty non-header line as excerpt (up to 160 chars)
                const lines = content.split('\n')
                const excerptLine = lines.find(
                    (l) => l.trim().length > 0 && !l.startsWith('#') && !l.startsWith('---')
                )
                const excerpt = excerptLine ? excerptLine.trim().slice(0, 160) : ''

                skills.push({ name: entry.name, path: skillMdPath, excerpt })
            }

            skills.sort((a, b) => a.name.localeCompare(b.name))

            return {
                data: {
                    configured: true,
                    skillsDir,
                    skills,
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
