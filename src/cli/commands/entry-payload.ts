import { readFileSync } from 'node:fs'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type {
    EntryType,
    RelationshipType,
    SignificanceType,
    ToolHandlerConfig,
} from '../../types/index.js'
import type { CliCommandLike } from '../../utils/config-resolver.js'
import { resolveProjectContext } from '../../utils/workspace-resolver.js'
import { activeProjectRegistry, pairStoredScope } from '../../utils/write-scope.js'
import { ValidationError } from '../../types/errors.js'
import { logger } from '../../utils/logger.js'
import * as yaml from 'yaml'
import type { BaseEntryOptionsSchema } from '../schemas.js'
import { CliExitError, getCliCommandDb } from './db-core.js'
import {
    UNKNOWN_RECORD_SCHEMA,
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
    autoLink?: boolean | undefined
}

export async function getDb(
    options: BaseEntryOptionsSchema,
    command: CliCommandLike,
    opts?: { throwOnExit?: boolean }
): Promise<{ db: IDatabaseAdapter; config: ToolHandlerConfig }> {
    const { db, serverOptions } = await getCliCommandDb(options, command, opts)
    return { db, config: serverOptions }
}

async function readPipedStdinWithTimeout(): Promise<string> {
    const chunks: Buffer[] = []
    let hasInput = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    return await new Promise<string>((resolve, reject) => {
        const cleanup = (): void => {
            if (timeoutId !== undefined) clearTimeout(timeoutId)
            process.stdin.off('data', onData)
            process.stdin.off('end', onEnd)
            process.stdin.off('error', onError)
            process.stdin.pause()
        }
        const onData = (chunk: string | Buffer): void => {
            hasInput = true
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk)
        }
        const onEnd = (): void => {
            cleanup()
            resolve(Buffer.concat(chunks).toString('utf8'))
        }
        const onError = (err: Error): void => {
            cleanup()
            reject(err)
        }
        timeoutId = setTimeout(() => {
            if (!hasInput) {
                cleanup()
                process.stderr.write(
                    'Error: Timed out waiting for stdin. You must provide --file or --content when running in a non-interactive shell.\n'
                )
                reject(new CliExitError(1))
            }
        }, STDIN_TIMEOUT_MS)
        timeoutId.unref()
        process.stdin.on('data', onData)
        process.stdin.once('end', onEnd)
        process.stdin.once('error', onError)
        process.stdin.resume()
    })
}

export async function parseContent(options: HealedEntryOptions): Promise<string> {
    const normalizedOptions: HealedEntryOptions = { ...options }
    applyCliEntryFlagAliases(normalizedOptions)
    const file = normalizedOptions.file
    const contentStr = normalizedOptions.content

    if (file !== undefined) {
        if (file.trim().length === 0) {
            throw new ValidationError('Must provide a non-empty --file path.')
        }
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
        const p = await import('@clack/prompts')
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

const FRONTMATTER_RE = /^---\r?\n(?:([\s\S]*?)\r?\n)??---(?:\r?\n|$)/

export function parseFrontmatter(rawContent: string): {
    frontmatter: Record<string, unknown>
    body: string
} {
    const content = rawContent.startsWith('\uFEFF') ? rawContent.slice(1) : rawContent
    const match = FRONTMATTER_RE.exec(content)
    if (match !== null) {
        const yamlStr = match[1] ?? ''
        const body = content.slice(match[0].length).trimStart()
        try {
            const parsed: unknown = yaml.parse(yamlStr)
            const parsedRec = UNKNOWN_RECORD_SCHEMA.safeParse(parsed)
            return { frontmatter: parsedRec.success ? parsedRec.data : {}, body }
        } catch (err) {
            logger.debug('Frontmatter YAML parse failed; treating as body content', {
                module: 'CLIEntryPayload',
                error: err instanceof Error ? err.message : String(err),
            })
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
        return UNKNOWN_RECORD_SCHEMA.parse(parsed)
    }
    throw new Error('Failed to parse --metadata JSON: expected a JSON object')
}

function resolvePayloadScope(
    explicitWorkspaceId: string | undefined,
    explicitProjectNum: number | undefined,
    fallbackWorkspaceId: string | undefined,
    config?: ToolHandlerConfig
): { projectNumber: number | undefined; workspaceId: string | undefined } {
    const resolved = resolveProjectContext(
        {
            workspace_id: explicitWorkspaceId ?? fallbackWorkspaceId,
            project_number: explicitProjectNum,
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
    const rawMetaRels = metadata['relationships']
    if (rawMetaRels !== undefined && rawMetaRels !== null && !Array.isArray(rawMetaRels)) {
        throw new ValidationError('Invalid metadata.relationships: expected an array.')
    }
    const hasCliRels = options.relationships !== undefined || options.relFile !== undefined
    const relationships = hasCliRels
        ? parseRelationships(options.relationships, options.relFile)
        : Array.isArray(rawMetaRels)
          ? relationshipsFromMetadata(rawMetaRels)
          : []

    let relatedIds = parseRelatedTo(options.relatedTo)
    if (metadata['related_to'] !== undefined && metadata['related_to'] !== null) {
        const metaRelatedIds = parseMetadataRelatedTo(metadata['related_to'])
        if (relatedIds.length === 0) {
            relatedIds = metaRelatedIds
        }
    }
    return { relationships, relatedIds }
}

const ANCHOR_PATH_KEYS = [
    'anchor_path', 'anchorPath', 'path', 'file', 'file_path', 'filepath',
    'filePath', 'value', 'target', 'uri', 'location',
] as const

function normalizeEntryAnchor(rawPath: string, rawType?: unknown): { anchor_path: string; anchor_type: string } {
    const normalizedPath = rawPath.trim().replace(/\\/g, '/')
    const customType = typeof rawType === 'string' && rawType.trim().length > 0 ? rawType.trim() : undefined
    return { anchor_path: normalizedPath, anchor_type: customType ?? (normalizedPath.includes('#') ? 'symbol' : 'file') }
}

function parseMetadataAnchors(
    raw: unknown
): { anchor_path: string; anchor_type: string }[] | undefined {
    if (!Array.isArray(raw) || raw.length === 0) return undefined
    const parsed: { anchor_path: string; anchor_type: string }[] = []
    for (const item of raw) {
        if (typeof item === 'string') {
            if (item.trim().length > 0) parsed.push(normalizeEntryAnchor(item))
        } else if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
            const parsedRec = UNKNOWN_RECORD_SCHEMA.safeParse(item)
            if (!parsedRec.success) continue
            const rec = parsedRec.data
            let pathRaw: string | undefined
            for (const k of ANCHOR_PATH_KEYS) {
                const v = rec[k]
                if (typeof v === 'string' && v.trim().length > 0) {
                    pathRaw = v
                    break
                }
            }
            const typeRaw = rec['anchor_type'] ?? rec['anchorType'] ?? rec['type']
            if (pathRaw !== undefined) parsed.push(normalizeEntryAnchor(pathRaw, typeRaw))
        }
    }
    return parsed.length > 0 ? parsed : undefined
}

export function buildEntryPayload(
    options: HealedEntryOptions,
    metadata: Record<string, unknown>,
    config?: ToolHandlerConfig,
    _content?: string,
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

    const autoLink =
        normalizedOptions.autoLink ??
        (metadata['auto_link'] === true || metadata['autoLink'] === true ? true : undefined)

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
        ...(autoLink !== undefined ? { autoLink } : {}),
    }
}
