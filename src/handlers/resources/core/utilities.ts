
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
import {
    resourceWorkspace,
    sliceUntrustedInline,
    withResourceTokenMeta,
} from '../shared.js'
// removed transformEntryRow
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'

import {
    assertSafeFilePath,
    assertSafeDirectoryPath,
    fenceNonCanonicalRefOrKey,
} from '../../../utils/security-utils.js'
import { logger } from '../../../utils/logger.js'

const READ_NOFOLLOW_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)

/**
 * [BOUNDARY] Reject symlinked operator paths (or symlinked parent directories) unless
 * their resolved target stays within explicitly configured `allowedRoots`.
 */
function assertOperatorPathNotSymlinkEscape(
    targetPath: string,
    allowedRoots: readonly string[],
    isDirectory: boolean
): void {
    const checkLink = (p: string): boolean => {
        const st = fs.lstatSync(p, { throwIfNoEntry: false })
        return st?.isSymbolicLink() === true
    }
    const targetIsLink = checkLink(targetPath)
    const parentIsLink = !isDirectory && checkLink(path.dirname(targetPath))
    if (!targetIsLink && !parentIsLink) return
    if (allowedRoots.length === 0) {
        throw new Error('Symlinked target or parent directory is not permitted')
    }
    if (isDirectory) {
        assertSafeDirectoryPath(targetPath, [...allowedRoots])
    } else {
        assertSafeFilePath(targetPath, [...allowedRoots])
    }
}

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

            const timestampMs = new Date(entry.timestamp).getTime()
            const daysSince = Math.floor((now - timestampMs) / MS_PER_DAY)
            const recency = Math.max(0, 1 - daysSince / RECENCY_WINDOW_DAYS)

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

interface CachedSkillEntry {
    skills: { name: string; path: string; excerpt: string; source: string }[]
    timestamp: number
}
const cachedSkillsMap = new Map<string, CachedSkillEntry>()
const SKILLS_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

let cachedShippedSkillsDir: string | null | undefined

/** Resolve the package's own skills/ directory (ships with npm package). */
function getShippedSkillsDir(): string | undefined {
    if (cachedShippedSkillsDir !== undefined) {
        return cachedShippedSkillsDir ?? undefined
    }
    try {
        const thisFile = fileURLToPath(import.meta.url)
        let dir = path.dirname(thisFile)

        // Find the closest package.json
        while (true) {
            const pkgJsonPath = path.join(dir, 'package.json')
            if (fs.existsSync(pkgJsonPath)) {
                const shipped = path.join(dir, 'skills')
                cachedShippedSkillsDir = fs.existsSync(shipped) ? shipped : null
                return cachedShippedSkillsDir ?? undefined
            }

            const parent = path.dirname(dir)
            if (parent === dir) {
                break
            }
            dir = parent
        }

        cachedShippedSkillsDir = null
        return undefined
    } catch {
        cachedShippedSkillsDir = null
        return undefined
    }
}

const SKILLS_READ_CONCURRENCY = 16

async function readSingleSkillEntry(
    dir: string,
    skillName: string,
    source: string
): Promise<{ name: string; path: string; excerpt: string; source: string } | null> {
    const skillMdPath = path.join(dir, skillName, 'SKILL.md')
    try {
        assertSafeFilePath(skillMdPath, [dir])
        const handle = await fs.promises.open(skillMdPath, READ_NOFOLLOW_FLAGS)
        let content: string
        try {
            const stats = await handle.stat()
            if (!stats.isFile() || stats.size > 1024 * 1024) return null
            content = await handle.readFile({ encoding: 'utf8' })
        } finally {
            await Promise.resolve(handle.close()).catch(() => undefined)
        }
        const bodyContent = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
        const lines = bodyContent.split('\n')
        const excerptLine = lines.find(
            (l) => l.trim().length > 0 && !l.startsWith('#') && !l.startsWith('---')
        )
        const excerpt = excerptLine ? sliceUntrustedInline(excerptLine.trim(), 160) : ''
        return { name: skillName, path: skillMdPath, excerpt, source }
    } catch (err) {
        logger.debug('Skipped unreadable skill entry', {
            module: 'UtilitiesResource',
            skillName,
            error: err instanceof Error ? err.message : String(err),
        })
        return null
    }
}

/** Scan a single skills directory and return skill entries. */
async function scanSkillsDir(
    dir: string,
    source: string
): Promise<{ name: string; path: string; excerpt: string; source: string }[]> {
    try {
        await fs.promises.access(dir)
    } catch {
        return []
    }
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    const dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name)
    const skills: { name: string; path: string; excerpt: string; source: string }[] = []

    for (let i = 0; i < dirNames.length; i += SKILLS_READ_CONCURRENCY) {
        const chunk = dirNames.slice(i, i + SKILLS_READ_CONCURRENCY)
        const settled = await Promise.allSettled(
            chunk.map((skillName) => readSingleSkillEntry(dir, skillName, source))
        )
        for (const outcome of settled) {
            if (outcome.status === 'fulfilled' && outcome.value !== null) {
                skills.push(outcome.value)
            }
        }
    }
    return skills
}

async function validateUserSkillsDir(userSkillsDir: string, allowedIoRoots: string[]): Promise<void> {
    try {
        assertOperatorPathNotSymlinkEscape(userSkillsDir, allowedIoRoots, true)
        const expandedRoots = [...allowedIoRoots, userSkillsDir]
        assertSafeDirectoryPath(userSkillsDir, expandedRoots)
    } catch (err) {
        logger.warning('Configured SKILLS_DIR_PATH failed validation', {
            module: 'UtilitiesResource',
            error: err instanceof Error ? err.message : String(err),
        })
        throw new ProtocolError(
            ProtocolErrorCode.InvalidParams,
            'Configured SKILLS_DIR_PATH failed path safety validation.'
        )
    }
    const stat = await fs.promises.stat(userSkillsDir).catch(() => null)
    if (stat?.isDirectory() !== true) {
        logger.warning('Configured SKILLS_DIR_PATH does not exist', {
            module: 'UtilitiesResource',
        })
        throw new ProtocolError(
            ProtocolErrorCode.InvalidParams,
            'Configured SKILLS_DIR_PATH does not exist.'
        )
    }
}

function buildSkillsPayloadResult(
    skills: { name: string; path: string; excerpt: string; source: string }[]
): ResourceResult {
    const payloadData = {
        configured: true,
        // Prevent path disclosure of host directories; fence non-canonical directory names.
        skills: skills.map((s) => ({
            name: fenceNonCanonicalRefOrKey(s.name),
            excerpt: s.excerpt,
            source: s.source,
        })),
        count: skills.length,
    }
    return {
        data: withResourceTokenMeta(payloadData),
    }
}

async function handleSkillsResource(
    _uri: string,
    context: ResourceContext
): Promise<ResourceResult> {
    const userSkillsDir = context.briefingConfig?.skillsDirPath ?? process.env['SKILLS_DIR_PATH']
    const shippedSkillsDir = getShippedSkillsDir()
    const hasAnySource = !!userSkillsDir || !!shippedSkillsDir

    if (userSkillsDir) {
        await validateUserSkillsDir(userSkillsDir, context.briefingConfig?.allowedIoRoots ?? [])
    }

    if (!hasAnySource) {
        throw new ProtocolError(
            ProtocolErrorCode.InvalidParams,
            'No skills available. Set SKILLS_DIR_PATH to index user skills.'
        )
    }

    try {
        const currentDirs = `${userSkillsDir ?? ''}|${shippedSkillsDir ?? ''}`
        const cached = cachedSkillsMap.get(currentDirs)
        if (cached && Date.now() - cached.timestamp < SKILLS_CACHE_TTL_MS) {
            return buildSkillsPayloadResult(cached.skills)
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
                skillMap.set(skill.name, skill)
            }
        }

        const skills = [...skillMap.values()].sort((a, b) => a.name.localeCompare(b.name))
        cachedSkillsMap.set(currentDirs, { skills, timestamp: Date.now() })
        if (cachedSkillsMap.size > 100) {
            const firstKey = cachedSkillsMap.keys().next().value
            if (firstKey) cachedSkillsMap.delete(firstKey)
        }

        return buildSkillsPayloadResult(skills)
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warning('Could not scan skills directory', {
            module: 'UtilitiesResource',
            error: message,
        })
        throw new ProtocolError(ProtocolErrorCode.InternalError, 'Could not scan skills directory')
    }
}

export const skillsResource: InternalResourceDef = {
    uri: 'memory://skills',
    name: 'Skills',
    title: 'Agent Skills Index',
    description: 'Index of available agent skills (shipped + user-configured via SKILLS_DIR_PATH)',
    mimeType: 'application/json',
    icons: [ICON_BRIEFING],
    annotations: withPriority(0.6, ASSISTANT_FOCUSED),
    handler: handleSkillsResource,
}
