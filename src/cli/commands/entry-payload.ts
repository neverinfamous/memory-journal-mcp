import { readFileSync } from 'node:fs'
import type { Command } from 'commander'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type {
    EntryType,
    RelationshipType,
    SignificanceType,
    ToolHandlerConfig,
} from '../../types/index.js'
import { resolveProjectContext } from '../../utils/workspace-resolver.js'
import { activeProjectRegistry, pairStoredScope } from '../../utils/write-scope.js'
import { ValidationError } from '../../types/errors.js'
import { logger } from '../../utils/logger.js'
import { z } from 'zod'
import * as p from '@clack/prompts'
import * as yaml from 'yaml'
import type { BaseEntryOptionsSchema } from '../schemas.js'
import { CliExitError, getCliCommandDb } from './db-helper.js'
import {
    applyCliEntryFlagAliases,
    parseRelationshipArray,
    relationshipsFromMetadata,
    resolveAutoContext,
    resolveEntryTypeAndTags,
    resolveExplicitProjectAndWorkspace,
    resolveScoresAndValidation,
    type HealedEntryOptions,
} from './entry-payload-helpers.js'

/** How long to wait for piped stdin before failing a non-interactive create. */
const STDIN_TIMEOUT_MS = 3000

export interface EntryPayload {
    entryType: EntryType | undefined
    significanceType: SignificanceType | undefined
    tags: string[] | undefined
    projectNumber: number | undefined
    workspaceId: string | undefined
    hasExplicitProject?: boolean
    hasExplicitWorkspace?: boolean
    trustScore: number | undefined
    impactScore: number | undefined
    validationStatus: 'passed' | 'failed' | 'none' | undefined
    sessionId: string | undefined
    autoContextStr: string | undefined
    relationships: { target_id: number; relation_type: RelationshipType }[]
    relatedIds: number[]
    anchors?: { anchor_path: string; anchor_type: string }[]
}

export async function getDb(
    options: BaseEntryOptionsSchema,
    command: Command
): Promise<{ db: IDatabaseAdapter; config: ToolHandlerConfig }> {
    const { db, serverOptions } = await getCliCommandDb(options, command)
    return { db, config: serverOptions }
}

async function readPipedStdinWithTimeout(): Promise<string> {
    let hasInput = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const readPromise = (async (): Promise<string> => {
        let stdinStr = ''
        for await (const chunk of process.stdin) {
            hasInput = true
            stdinStr += chunk
        }
        return stdinStr
    })()
    readPromise.catch(() => undefined)
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
            if (!hasInput) {
                process.stderr.write(
                    'Error: Timed out waiting for stdin. You must provide --file or --content when running in a non-interactive shell.\n'
                )
                reject(new CliExitError(1))
            }
        }, STDIN_TIMEOUT_MS)
        timeoutId.unref()
    })
    try {
        return await Promise.race([readPromise, timeoutPromise])
    } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
}

export async function parseContent(options: HealedEntryOptions): Promise<string> {
    const normalizedOptions: HealedEntryOptions = { ...options }
    applyCliEntryFlagAliases(normalizedOptions)
    const file = normalizedOptions.file
    const contentStr = normalizedOptions.content

    if (file) {
        return readFileSync(file, 'utf-8')
    }
    if (contentStr !== undefined) {
        return contentStr
    }

    if (!process.stdin.isTTY) {
        const stdinStr = await readPipedStdinWithTimeout()
        if (stdinStr.trim().length > 0) {
            return stdinStr
        }
    } else if (!process.env['CI'] && !process.env['NonInteractive']) {
        p.intro('Interactive Entry Creation')

        const titlePrompt = await p.text({
            message: 'Title (optional):',
            placeholder: 'My entry title',
        })

        if (p.isCancel(titlePrompt)) {
            p.cancel('Operation cancelled.')
            throw new CliExitError(0)
        }

        const contentPrompt = await p.text({
            message: 'Content (for multiline, use --file):',
            placeholder: 'Write your short journal entry here...',
            validate: (value) => {
                if (!value) return 'Content is required.'
                return undefined
            },
        })

        if (p.isCancel(contentPrompt)) {
            p.cancel('Operation cancelled.')
            throw new CliExitError(0)
        }

        if (titlePrompt) {
            options.title = titlePrompt
        }

        p.outro('Proceeding with entry creation...')
        return contentPrompt
    }

    process.stderr.write(
        'Error: Must provide either --file, --content, pipe data to stdin, or run interactively\n'
    )
    throw new CliExitError(1)
}

export function parseFrontmatter(rawContent: string): {
    frontmatter: Record<string, unknown>
    body: string
} {
    if (rawContent.startsWith('---\n') || rawContent.startsWith('---\r\n')) {
        const endOfFrontmatter = rawContent.indexOf('\n---\n', 3)
        const endOfFrontmatterWindows = rawContent.indexOf('\r\n---\r\n', 4)

        let endIdx = -1
        let skip = 5
        if (
            endOfFrontmatter !== -1 &&
            (endOfFrontmatterWindows === -1 || endOfFrontmatter < endOfFrontmatterWindows)
        ) {
            endIdx = endOfFrontmatter
            skip = 5
        } else if (endOfFrontmatterWindows !== -1) {
            endIdx = endOfFrontmatterWindows
            skip = 7
        }

        if (endIdx !== -1) {
            const yamlStr = rawContent.slice(rawContent.indexOf('\n') + 1, endIdx)
            const body = rawContent.slice(endIdx + skip).trimStart()
            try {
                const parsed: unknown = yaml.parse(yamlStr)
                const parsedRec = z.record(z.string(), z.unknown()).safeParse(parsed)
                return { frontmatter: parsedRec.success ? parsedRec.data : {}, body }
            } catch (err) {
                logger.debug('Frontmatter YAML parse failed; treating as body content', {
                    module: 'CLIEntryPayload',
                    error: err instanceof Error ? err.message : String(err),
                })
            }
        }
    }
    return { frontmatter: {}, body: rawContent }
}

export function parseRelatedTo(relatedToStr: unknown): number[] {
    if (typeof relatedToStr !== 'string') return []
    return relatedToStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((token) => {
            if (!/^[1-9]\d*$/.test(token)) {
                throw new ValidationError(
                    `Invalid --related-to entry ID '${token}'. Expected positive integers separated by commas.`
                )
            }
            const parsed = Number(token)
            if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== token) {
                throw new ValidationError(
                    `Invalid --related-to entry ID '${token}'. Expected a positive integer.`
                )
            }
            return parsed
        })
}

export function parseRelationships(
    relationshipsStr: unknown,
    relFileStr: unknown
): { target_id: number; relation_type: RelationshipType }[] {
    let str = relationshipsStr
    const source = typeof relFileStr === 'string' ? '--rel-file' : '--relationships'
    if (typeof relFileStr === 'string') {
        try {
            str = readFileSync(relFileStr, 'utf-8')
        } catch (e) {
            throw new Error(
                `Failed to read --rel-file: ${e instanceof Error ? e.message : String(e)}`,
                { cause: e }
            )
        }
    }

    if (typeof str !== 'string') return []
    let parsed: unknown
    try {
        parsed = JSON.parse(str)
    } catch (e) {
        throw new Error(
            `Failed to parse relationships JSON: ${e instanceof Error ? e.message : String(e)}`,
            { cause: e }
        )
    }
    if (!Array.isArray(parsed)) {
        throw new Error('Failed to parse relationships JSON: expected a JSON array')
    }
    return parseRelationshipArray(parsed, source)
}

export function parseMetadata(metadataFile: unknown): Record<string, unknown> {
    if (typeof metadataFile !== 'string') return {}
    let parsed: unknown
    try {
        const str = readFileSync(metadataFile, 'utf-8')
        parsed = JSON.parse(str)
    } catch (e) {
        throw new Error(
            `Failed to parse --metadata JSON: ${e instanceof Error ? e.message : String(e)}`,
            { cause: e }
        )
    }
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return z.record(z.string(), z.unknown()).parse(parsed)
    }
    throw new Error('Failed to parse --metadata JSON: expected a JSON object')
}

function resolvePayloadScope(
    explicitWorkspaceId: string | undefined,
    explicitProjectNum: number | undefined,
    fallbackWorkspaceId: string | undefined,
    content: string | undefined,
    tags: string[] | undefined,
    config?: ToolHandlerConfig
): { projectNumber: number | undefined; workspaceId: string | undefined } {
    const resolved = resolveProjectContext(
        {
            workspace_id: explicitWorkspaceId ?? fallbackWorkspaceId,
            project_number: explicitProjectNum,
            content,
            tags,
            preferCwdOverKeywords: true,
        },
        config
    )
    const paired = pairStoredScope(
        resolved.workspaceId,
        explicitProjectNum ?? resolved.projectNumber,
        activeProjectRegistry(config?.projectRegistry)
    )
    return {
        projectNumber: paired.projectNumber ?? explicitProjectNum,
        workspaceId: paired.workspaceId ?? resolved.workspaceId,
    }
}

function parseMetadataRelatedTo(raw: unknown): number[] {
    if (!Array.isArray(raw)) {
        throw new ValidationError(
            'Invalid metadata related_to: expected an array of positive integers.'
        )
    }
    return raw.map((item) => {
        if (typeof item === 'number') {
            if (Number.isSafeInteger(item) && item > 0) {
                return item
            }
            throw new ValidationError(
                `Invalid metadata related_to entry '${String(item)}': expected a positive integer.`
            )
        }
        if (typeof item === 'string' && /^[1-9]\d*$/.test(item)) {
            const parsed = Number(item)
            if (Number.isSafeInteger(parsed) && parsed > 0) {
                return parsed
            }
        }
        throw new ValidationError(
            `Invalid metadata related_to entry '${String(item)}': expected a positive integer.`
        )
    })
}

function resolvePayloadRelationships(
    options: HealedEntryOptions,
    metadata: Record<string, unknown>
): {
    relationships: { target_id: number; relation_type: RelationshipType }[]
    relatedIds: number[]
    anchors?: { anchor_path: string; anchor_type: string }[]
} {
    const relationships =
        metadata['relationships'] !== undefined &&
        metadata['relationships'] !== null &&
        Array.isArray(metadata['relationships'])
            ? relationshipsFromMetadata(metadata['relationships'])
            : parseRelationships(options.relationships, options.relFile)

    let relatedIds = parseRelatedTo(options.relatedTo)
    if (metadata['related_to'] !== undefined && metadata['related_to'] !== null) {
        const metaRelatedIds = parseMetadataRelatedTo(metadata['related_to'])
        if (relatedIds.length === 0) {
            relatedIds = metaRelatedIds
        }
    }
    return { relationships, relatedIds }
}

function parseMetadataAnchors(
    raw: unknown
): { anchor_path: string; anchor_type: string }[] | undefined {
    if (!Array.isArray(raw) || raw.length === 0) return undefined
    const parsed: { anchor_path: string; anchor_type: string }[] = []
    for (const item of raw) {
        if (typeof item === 'string') {
            const trimmed = item.trim()
            if (trimmed.length > 0) {
                parsed.push({ anchor_path: trimmed, anchor_type: 'file' })
            }
        } else if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
            const rec = item as Record<string, unknown>
            const pathRaw = rec['anchor_path'] ?? rec['anchorPath'] ?? rec['path']
            const typeRaw = rec['anchor_type'] ?? rec['anchorType'] ?? rec['type']
            if (typeof pathRaw === 'string' && pathRaw.trim().length > 0) {
                parsed.push({
                    anchor_path: pathRaw.trim(),
                    anchor_type:
                        typeof typeRaw === 'string' && typeRaw.trim().length > 0
                            ? typeRaw.trim()
                            : 'file',
                })
            }
        }
    }
    return parsed.length > 0 ? parsed : undefined
}

export function buildEntryPayload(
    options: HealedEntryOptions,
    metadata: Record<string, unknown>,
    config?: ToolHandlerConfig,
    content?: string,
    fallbackWorkspaceId?: string
): EntryPayload {
    const normalizedOptions: HealedEntryOptions = { ...options }
    applyCliEntryFlagAliases(normalizedOptions)
    const { entryType, tags } = resolveEntryTypeAndTags(normalizedOptions, metadata)
    const { explicitProjectNum, explicitWorkspaceId } = resolveExplicitProjectAndWorkspace(
        normalizedOptions,
        metadata
    )

    const { projectNumber, workspaceId } = resolvePayloadScope(
        explicitWorkspaceId,
        explicitProjectNum,
        fallbackWorkspaceId,
        content ?? normalizedOptions.content,
        tags,
        config
    )

    const { trustScore, impactScore, validationStatus, sessionId, significanceType } =
        resolveScoresAndValidation(normalizedOptions, metadata)
    const autoContextStr = resolveAutoContext(
        normalizedOptions.autoContext,
        normalizedOptions.autoContextFile,
        metadata
    )
    const { relationships, relatedIds } = resolvePayloadRelationships(normalizedOptions, metadata)
    const anchors = parseMetadataAnchors(metadata['anchors'])

    return {
        entryType,
        significanceType,
        tags,
        projectNumber,
        workspaceId,
        hasExplicitProject: explicitProjectNum !== undefined,
        hasExplicitWorkspace:
            typeof explicitWorkspaceId === 'string' &&
            explicitWorkspaceId.trim().length > 0 &&
            explicitWorkspaceId.trim() !== '*',
        trustScore,
        impactScore,
        validationStatus,
        sessionId,
        autoContextStr,
        relationships,
        relatedIds,
        ...(anchors !== undefined ? { anchors } : {}),
    }
}
