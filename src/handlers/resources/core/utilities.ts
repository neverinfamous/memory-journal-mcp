
import {
    ICON_CLOCK,
    ICON_STAR,
    ICON_BRIEFING,
} from '../../../constants/icons.js'
// removed ENTRY_COLUMNS
import {
    withPriority,
    ASSISTANT_FOCUSED,
} from '../../../utils/resource-annotations.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../shared.js'
import { resourceWorkspace, withResourceTokenMeta } from '../shared.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'

import { assertSafeFilePath } from '../../../utils/security-utils.js'
import { logger } from '../../../utils/logger.js'
import {
    assertOperatorPathNotSymlinkEscape,
    READ_NOFOLLOW_FLAGS,
    skillsResource,
} from './utilities-skills.js'

export { skillsResource }

export const recentResource: InternalResourceDef = {
    uri: 'memory://recent',
    name: 'Recent Entries',
    title: 'Recent Journal Entries',
    description: '10 most recent journal entries',
    mimeType: 'application/json',
    icons: [ICON_CLOCK],
    annotations: withPriority(0.8, ASSISTANT_FOCUSED),
    handler: (_uri: string, context: ResourceContext): ResourceResult => {
        const { entries } = context.db.getRecentEntries(10, undefined, 'timestamp', undefined, false, resourceWorkspace(context))
        const lastModified = entries[0]?.timestamp ?? new Date().toISOString()
        const payloadData = { entries, count: entries.length }
        return {
            data: withResourceTokenMeta(payloadData),
            annotations: { lastModified },
        }
    },
}

const CAUSAL_REL_TYPES = new Set(['blocked_by', 'resolved', 'caused'])

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
        const wsId = resourceWorkspace(context)
        const entries = context.db.getSignificantEntries(100, undefined, wsId)

        const now = Date.now()
        const MS_PER_DAY = 86_400_000
        const RECENCY_WINDOW_DAYS = 90
        const MAX_REL_SCORE_AT = 5
        const MAX_CAUSAL_SCORE_AT = 3

        const entryIds = entries.map((e) => e.id)
        const relationshipsMap = context.db.getRelationshipsForEntries(entryIds, wsId)

        const entriesWithImportance = entries.map((entry) => {
            const relationships = relationshipsMap.get(entry.id) ?? []
            const relCount = relationships.length
            const causalCount = relationships.filter((r) =>
                CAUSAL_REL_TYPES.has(r.relationshipType)
            ).length

            const rawTimestampMs = new Date(entry.timestamp).getTime()
            const hasValidTimestamp = Number.isFinite(rawTimestampMs)
            const timestampMs = hasValidTimestamp ? rawTimestampMs : 0
            const daysSince = hasValidTimestamp ? Math.floor((now - timestampMs) / MS_PER_DAY) : RECENCY_WINDOW_DAYS
            const recency = hasValidTimestamp ? Math.max(0, 1 - daysSince / RECENCY_WINDOW_DAYS) : 0

            const importance =
                Math.round(
                    (1.0 * 0.3 +
                        Math.min(relCount / MAX_REL_SCORE_AT, 1.0) * 0.35 +
                        Math.min(causalCount / MAX_CAUSAL_SCORE_AT, 1.0) * 0.2 +
                        recency * 0.15) *
                        100
                ) / 100

            return { ...entry, importance, timestampMs }
        })

        entriesWithImportance.sort((a, b) => {
            if (b.importance !== a.importance) {
                return b.importance - a.importance
            }
            return b.timestampMs - a.timestampMs
        })
        const top20 = entriesWithImportance.slice(0, 20)
        const payloadData = { entries: top20, count: top20.length }
        return {
            data: withResourceTokenMeta(payloadData),
        }
    },
}



interface CachedRuleEntry {
    content: string
    timestamp: number
    mtimeMs: number
}
const cachedRulesMap = new Map<string, CachedRuleEntry>()
const RULES_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

async function readRulesFileContent(rulesPath: string): Promise<ResourceResult> {
    const cached = cachedRulesMap.get(rulesPath)
    if (cached && Date.now() - cached.timestamp < RULES_CACHE_TTL_MS) {
        const stat = await fs.promises.stat(rulesPath).catch(() => null)
        if (stat !== null && stat.mtimeMs === cached.mtimeMs) {
            return {
                data: cached.content,
                annotations: { lastModified: new Date(stat.mtimeMs).toISOString() },
            }
        }
    }

    const file = await fs.promises.open(rulesPath, READ_NOFOLLOW_FLAGS)
    try {
        const stat = await file.stat()
        if (typeof stat.isFile === 'function' && !stat.isFile()) {
            throw new Error('Rules path is not a regular file')
        }
        if (stat.size > 1024 * 1024) {
            throw new Error('Rules file exceeds 1MB limit')
        }
        const content = await file.readFile('utf8')
        const mtimeMs = typeof stat.mtimeMs === 'number' ? stat.mtimeMs : Date.now()
        cachedRulesMap.set(rulesPath, { content, timestamp: Date.now(), mtimeMs })
        if (cachedRulesMap.size > 100) {
            const firstKey = cachedRulesMap.keys().next().value
            if (firstKey) cachedRulesMap.delete(firstKey)
        }
    } finally {
        await Promise.resolve(file.close()).catch(() => undefined)
    }

    const cachedData = cachedRulesMap.get(rulesPath)
    return {
        data: cachedData ? cachedData.content : '',
        annotations: {
            lastModified: new Date(cachedData ? cachedData.mtimeMs : Date.now()).toISOString(),
        },
    }
}

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
            throw new ProtocolError(
                ProtocolErrorCode.InternalError,
                'RULES_FILE_PATH is not configured. Set this env var to serve rules content.'
            )
        }
        try {
            const allowedRoots = context.briefingConfig?.allowedIoRoots ?? []
            assertOperatorPathNotSymlinkEscape(rulesPath, allowedRoots, false)
            assertSafeFilePath(rulesPath, [...allowedRoots, path.dirname(rulesPath)])
        } catch (err) {
            logger.warning('Configured RULES_FILE_PATH failed path safety validation', {
                module: 'UtilitiesResource',
                error: err instanceof Error ? err.message : String(err),
            })
            throw new ProtocolError(
                ProtocolErrorCode.InvalidParams,
                'Configured RULES_FILE_PATH failed path safety validation.'
            )
        }

        try {
            return await readRulesFileContent(rulesPath)
        } catch (err) {
            logger.warning('Could not read rules file', {
                module: 'UtilitiesResource',
                error: err instanceof Error ? err.message : String(err),
            })
            throw new ProtocolError(ProtocolErrorCode.InternalError, 'Could not read rules file')
        }
    },
}

export const workflowsResource: InternalResourceDef = {
    uri: 'memory://workflows',
    name: 'Workflows',
    title: 'Agent Workflow Summaries',
    description:
        'Configured agent workflow summary string (from --workflow-summary, workflowSummary, or MEMORY_JOURNAL_WORKFLOW_SUMMARY)',
    mimeType: 'application/json',
    icons: [ICON_BRIEFING],
    annotations: withPriority(0.6, ASSISTANT_FOCUSED),
    handler: (_uri: string, context: ResourceContext): ResourceResult => {
        // Prefer briefingConfig.workflowSummary (set via CLI --workflow-summary or
        // MEMORY_JOURNAL_WORKFLOW_SUMMARY env var in cli.ts). Fall back to env var
        // for callers that don't pass a briefingConfig (e.g., tests, direct readResource).
        const workflowSummary: string | undefined =
            context.briefingConfig?.workflowSummary ??
            process.env['MEMORY_JOURNAL_WORKFLOW_SUMMARY']
        if (workflowSummary === undefined || workflowSummary === '') {
            throw new ProtocolError(ProtocolErrorCode.InvalidParams, 
                'No workflow summary is available. Set MEMORY_JOURNAL_WORKFLOW_SUMMARY env var or use --workflow-summary.'
            )
        }
        const payloadData = {
            configured: true,
            summary: workflowSummary,
        }
        return {
            data: withResourceTokenMeta(payloadData),
        }
    },
}
