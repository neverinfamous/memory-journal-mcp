import { readFileSync } from 'node:fs'
import type { Command } from 'commander'
import { DatabaseAdapterFactory } from '../../database/adapter-factory.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { EntryType, RelationshipType, ToolHandlerConfig } from '../../types/index.js'
import { ConfigResolver } from '../../utils/config-resolver.js'
import { resolveProjectContext } from '../../utils/workspace-resolver.js'
import { activeProjectRegistry, pairStoredScope } from '../../utils/write-scope.js'
import { logger } from '../../utils/logger.js'
import { buildServerOptions } from '../server-options-builder.js'
import { z } from 'zod'
import * as p from '@clack/prompts'
import * as yaml from 'yaml'
import type { BaseEntryOptionsSchema } from '../schemas.js'
import {
    applyCliEntryFlagAliases,
    relationshipsFromMetadata,
    relationTypeSchema,
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
}

export async function getDb(
    options: BaseEntryOptionsSchema,
    command: Command
): Promise<{ db: IDatabaseAdapter; config: ToolHandlerConfig }> {
    let resolver: ConfigResolver
    const configPath = options.config ?? process.env['MEMORY_JOURNAL_CONFIG']
    const configErrors: string[] = []

    try {
        resolver = new ConfigResolver(command, options, configPath)
    } catch (err) {
        configErrors.push(err instanceof Error ? err.message : String(err))
        resolver = new ConfigResolver(command, {}, undefined)
    }

    const { serverOptions } = buildServerOptions(resolver, options, command, configErrors)

    if (configErrors.length > 0) {
        process.stderr.write('Startup Configuration Errors:\n')
        configErrors.forEach((err) => process.stderr.write(` - ${err}\n`))
        process.exit(1)
    }

    const useTeamDb = options.team === true

    if (useTeamDb && typeof serverOptions.teamDbPath !== 'string') {
        process.stderr.write(
            'Error: Cannot use --team flag because no team database is configured.\n'
        )
        process.exit(1)
    }

    const dbPath = useTeamDb ? String(serverOptions.teamDbPath) : serverOptions.dbPath
    const db = await DatabaseAdapterFactory.create(dbPath, serverOptions)
    await db.initialize()
    return { db, config: serverOptions }
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
        let stdinStr = ''

        const timeout = setTimeout(() => {
            if (stdinStr.length === 0) {
                process.stderr.write(
                    'Error: Timed out waiting for stdin. You must provide --file or --content when running in a non-interactive shell.\n'
                )
                process.exit(1)
            }
        }, STDIN_TIMEOUT_MS)
        timeout.unref()

        try {
            for await (const chunk of process.stdin) {
                stdinStr += chunk
            }
        } finally {
            clearTimeout(timeout)
        }

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
            process.exit(0)
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
            process.exit(0)
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
    process.exit(1)
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
        .map(Number)
}

export function parseRelationships(
    relationshipsStr: unknown,
    relFileStr: unknown
): { target_id: number; relation_type: RelationshipType }[] {
    let str = relationshipsStr
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
    return parsed.flatMap((r: unknown) => {
        if (typeof r !== 'object' || r === null) return []
        const rec = z.record(z.string(), z.unknown()).parse(r)
        const targetId = Number(rec['target_id'])
        if (isNaN(targetId)) return []
        const relType = relationTypeSchema.safeParse(rec['relation_type'])
        if (!relType.success) {
            throw new Error(
                `Invalid relation_type '${String(rec['relation_type'])}'. Expected one of: ${relationTypeSchema.options.join(', ')}`
            )
        }
        return [{ target_id: targetId, relation_type: relType.data }]
    })
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

export function buildEntryPayload(
    options: HealedEntryOptions,
    metadata: Record<string, unknown>,
    config?: ToolHandlerConfig,
    content?: string
): EntryPayload {
    const normalizedOptions: HealedEntryOptions = { ...options }
    applyCliEntryFlagAliases(normalizedOptions)
    const { entryType, tags } = resolveEntryTypeAndTags(normalizedOptions, metadata)
    const { explicitProjectNum, explicitWorkspaceId } = resolveExplicitProjectAndWorkspace(
        normalizedOptions,
        metadata
    )

    const resolved = resolveProjectContext(
        {
            workspace_id: explicitWorkspaceId,
            project_number: explicitProjectNum,
            content: content ?? normalizedOptions.content,
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
    const projectNumber = paired.projectNumber ?? explicitProjectNum
    const workspaceId = paired.workspaceId ?? resolved.workspaceId

    const { trustScore, impactScore, validationStatus, sessionId } = resolveScoresAndValidation(
        normalizedOptions,
        metadata
    )

    const autoContextStr = resolveAutoContext(
        normalizedOptions.autoContext,
        normalizedOptions.autoContextFile,
        metadata
    )

    let relationships: { target_id: number; relation_type: RelationshipType }[]
    if (
        metadata['relationships'] !== undefined &&
        metadata['relationships'] !== null &&
        Array.isArray(metadata['relationships'])
    ) {
        relationships = relationshipsFromMetadata(metadata['relationships'])
    } else {
        relationships = parseRelationships(
            normalizedOptions.relationships,
            normalizedOptions.relFile
        )
    }

    let relatedIds = parseRelatedTo(normalizedOptions.relatedTo)
    if (relatedIds.length === 0 && Array.isArray(metadata['related_to'])) {
        relatedIds = metadata['related_to'].map(Number).filter((n) => !isNaN(n))
    }

    return {
        entryType,
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
    }
}
