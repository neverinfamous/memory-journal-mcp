import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'
import { ICON_BRIEFING } from '../../../constants/icons.js'
import { logger } from '../../../utils/logger.js'
import { ASSISTANT_FOCUSED, withPriority } from '../../../utils/resource-annotations.js'
import {
    assertSafeDirectoryPath,
    assertSafeFilePath,
    fenceNonCanonicalRefOrKey,
} from '../../../utils/security-utils.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../shared.js'
import { sliceUntrustedInline, withResourceTokenMeta } from '../shared.js'

export const READ_NOFOLLOW_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)

/**
 * [BOUNDARY] Reject symlinked operator paths (or any symlinked ancestor directory) unless
 * their resolved target stays within explicitly configured `allowedRoots`.
 */
export function assertOperatorPathNotSymlinkEscape(
    targetPath: string,
    allowedRoots: readonly string[],
    isDirectory: boolean
): void {
    const resolved = path.resolve(targetPath)
    const root = path.parse(resolved).root
    let current = resolved
    let hasSymlink = false
    for (;;) {
        const st = fs.lstatSync(current, { throwIfNoEntry: false })
        if (st?.isSymbolicLink() === true) {
            hasSymlink = true
            break
        }
        if (current === root) break
        const parent = path.dirname(current)
        if (parent === current) break
        current = parent
    }
    if (!hasSymlink) return
    if (allowedRoots.length === 0) {
        throw new Error('Symlinked target or ancestor directory is not permitted')
    }
    if (isDirectory) {
        assertSafeDirectoryPath(targetPath, [...allowedRoots])
    } else {
        assertSafeFilePath(targetPath, [...allowedRoots])
    }
}

interface CachedSkillEntry {
    skills: { name: string; path: string; excerpt: string; source: string }[]
    timestamp: number
}
const cachedSkillsMap = new Map<string, CachedSkillEntry>()
const SKILLS_CACHE_TTL_MS = 5 * 60 * 1000
const SKILLS_READ_CONCURRENCY = 16
let cachedShippedSkillsDir: string | null | undefined

/** Resolve the package's own skills/ directory (ships with npm package). */
function getShippedSkillsDir(): string | undefined {
    if (cachedShippedSkillsDir !== undefined) {
        return cachedShippedSkillsDir ?? undefined
    }
    try {
        const thisFile = fileURLToPath(import.meta.url)
        let dir = path.dirname(thisFile)
        for (;;) {
            if (fs.existsSync(path.join(dir, 'package.json'))) {
                const shipped = path.join(dir, 'skills')
                cachedShippedSkillsDir = fs.existsSync(shipped) ? shipped : null
                return cachedShippedSkillsDir ?? undefined
            }
            const parent = path.dirname(dir)
            if (parent === dir) break
            dir = parent
        }
        cachedShippedSkillsDir = null
        return undefined
    } catch {
        cachedShippedSkillsDir = null
        return undefined
    }
}

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
        const bodyContent = content.replace(
            /^\uFEFF?---(?:\r\n|\r|\n)[\s\S]*?(?:\r\n|\r|\n)---(?:\r\n|\r|\n)?/,
            ''
        )
        const lines = bodyContent.split(/\r\n|\r|\n/)
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

    const chunks: string[][] = []
    for (let i = 0; i < dirNames.length; i += SKILLS_READ_CONCURRENCY) {
        chunks.push(dirNames.slice(i, i + SKILLS_READ_CONCURRENCY))
    }
    await chunks.reduce<Promise<void>>(
        (chain, chunk) =>
            chain.then(async () => {
                const settled = await Promise.allSettled(
                    chunk.map((skillName) => readSingleSkillEntry(dir, skillName, source))
                )
                for (const outcome of settled) {
                    if (outcome.status === 'fulfilled' && outcome.value !== null) {
                        skills.push(outcome.value)
                    }
                }
            }),
        Promise.resolve()
    )
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
        logger.warning('Could not scan skills directory', {
            module: 'UtilitiesResource',
            error: err instanceof Error ? err.message : String(err),
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
