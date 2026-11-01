import { readFileSync } from 'node:fs'
import type { Command } from 'commander'
import { DatabaseAdapterFactory } from '../../database/adapter-factory.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { EntryType, ToolHandlerConfig } from '../../types/index.js'
import { ConfigResolver } from '../../utils/config-resolver.js'
import { resolveProjectNumberFromPath, resolveWorkspaceId } from '../../utils/workspace-resolver.js'
import { buildServerOptions } from '../server-options-builder.js'
import { z } from 'zod'
import * as p from '@clack/prompts'
import * as yaml from 'yaml'
import type { BaseEntryOptionsSchema, createEntryOptionsSchema } from '../schemas.js'

export interface EntryPayload {
    entryType: EntryType | undefined
    tags: string[] | undefined
    projectNumber: number | undefined
    workspaceId: string | undefined
    trustScore: number | undefined
    impactScore: number | undefined
    validationStatus: 'passed' | 'failed' | 'none' | undefined
    sessionId: string | undefined
    autoContextStr: string | undefined
    relationships: { target_id: number; relation_type: string }[]
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

export async function parseContent(
    options: z.infer<typeof createEntryOptionsSchema>
): Promise<string> {
    const file = options.file
    const contentStr = options.content

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
        }, 3000)

        for await (const chunk of process.stdin) {
            stdinStr += chunk
        }
        clearTimeout(timeout)

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
            } catch {
                // Return as-is if parsing fails
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
): { target_id: number; relation_type: string }[] {
    let str = relationshipsStr
    if (typeof relFileStr === 'string') {
        try {
            str = readFileSync(relFileStr, 'utf-8')
        } catch (e) {
            process.stderr.write(
                `Warning: Failed to read --rel-file: ${e instanceof Error ? e.message : String(e)}\n`
            )
        }
    }

    if (typeof str !== 'string') return []
    try {
        const parsed: unknown = JSON.parse(str)
        if (Array.isArray(parsed)) {
            return parsed
                .map((r: unknown) => {
                    if (typeof r !== 'object' || r === null) return null
                    const rec = z.record(z.string(), z.unknown()).parse(r)
                    return {
                        target_id: Number(rec['target_id']),
                        relation_type: String(rec['relation_type']),
                    }
                })
                .filter(
                    (r): r is { target_id: number; relation_type: string } =>
                        r !== null && !isNaN(r.target_id) && Boolean(r.relation_type)
                )
        }
    } catch (e) {
        process.stderr.write(
            `Warning: Failed to parse relationships JSON: ${e instanceof Error ? e.message : String(e)}\n`
        )
    }
    return []
}

export function parseMetadata(metadataFile: unknown): Record<string, unknown> {
    if (typeof metadataFile !== 'string') return {}
    try {
        const str = readFileSync(metadataFile, 'utf-8')
        const parsed: unknown = JSON.parse(str)
        if (typeof parsed === 'object' && parsed !== null) {
            return z.record(z.string(), z.unknown()).parse(parsed)
        }
    } catch (e) {
        process.stderr.write(
            `Warning: Failed to parse --metadata JSON: ${e instanceof Error ? e.message : String(e)}\n`
        )
    }
    return {}
}

export function buildEntryPayload(
    options: z.infer<typeof createEntryOptionsSchema>,
    metadata: Record<string, unknown>,
    config?: ToolHandlerConfig
): EntryPayload {
    const entryTypeStr =
        options.type ??
        options.category ??
        metadata['type'] ??
        metadata['entry_type'] ??
        metadata['entryType']
    const entryType = entryTypeStr as EntryType | undefined

    const tagsStr = options.tags
    let tags: string[] | undefined
    if (tagsStr !== undefined) {
        tags = tagsStr
            .split(/[,\s]+/)
            .map((t) => t.trim())
            .filter(Boolean)
    } else if (metadata['tags'] !== undefined && metadata['tags'] !== null) {
        tags = Array.isArray(metadata['tags']) ? metadata['tags'].map(String) : undefined
    }

    const projectRaw =
        options.project ??
        options.project_number ??
        metadata['project'] ??
        metadata['projectNumber'] ??
        metadata['project_number']
    let projectNumber = projectRaw !== undefined ? Number(projectRaw) : undefined
    if (projectNumber === undefined || isNaN(projectNumber)) {
        projectNumber = resolveProjectNumberFromPath(process.cwd())
    }

    const optsRec = z.record(z.string(), z.unknown()).parse(options)
    const explicitWorkspaceId =
        optsRec['workspaceId'] ??
        optsRec['workspace_id'] ??
        metadata['workspaceId'] ??
        metadata['workspace_id']
    const workspaceId = resolveWorkspaceId(
        explicitWorkspaceId as string | undefined,
        projectNumber,
        config
    )

    const trustRaw =
        options.trustScore ??
        options.trust_score ??
        options.confidence ??
        metadata['trust'] ??
        metadata['trustScore'] ??
        metadata['trust_score'] ??
        metadata['confidence']
    const trustScore = trustRaw !== undefined ? Number(trustRaw) : undefined

    const impactRaw =
        options.impactScore ??
        options.impact_score ??
        metadata['impact'] ??
        metadata['impactScore'] ??
        metadata['impact_score']
    const impactScore = impactRaw !== undefined ? Number(impactRaw) : undefined

    const valStatusRaw =
        options.validationStatus ??
        options.validation_status ??
        options.validation ??
        metadata['validation_status'] ??
        metadata['validationStatus'] ??
        metadata['validation']
    let validationStatus: 'passed' | 'failed' | 'none' | undefined = undefined
    if (valStatusRaw !== undefined && valStatusRaw !== null) {
        if (typeof valStatusRaw === 'boolean') {
            validationStatus = valStatusRaw ? 'passed' : 'failed'
        } else if (typeof valStatusRaw === 'string') {
            const lower = valStatusRaw.trim().toLowerCase()
            if (
                [
                    'passed',
                    'pass',
                    'success',
                    'ok',
                    'validated',
                    'valid',
                    'verified',
                    'true',
                    '1',
                ].includes(lower)
            ) {
                validationStatus = 'passed'
            } else if (['failed', 'fail', 'error', 'failing', 'false', '0'].includes(lower)) {
                validationStatus = 'failed'
            } else {
                validationStatus = 'none'
            }
        } else if (typeof valStatusRaw === 'number') {
            validationStatus = valStatusRaw === 1 ? 'passed' : valStatusRaw === 0 ? 'failed' : 'none'
        }
    }

    const sessionIdRaw =
        options.sessionId ?? options.session_id ?? metadata['session_id'] ?? metadata['sessionId']
    const sessionId = sessionIdRaw as string | undefined

    let autoContextStr = options.autoContext
    const autoContextFile = options.autoContextFile
    if (autoContextFile) {
        try {
            autoContextStr = readFileSync(autoContextFile, 'utf-8')
        } catch (e) {
            process.stderr.write(
                `Warning: Failed to read --auto-context-file: ${e instanceof Error ? e.message : String(e)}\n`
            )
        }
    } else if (
        autoContextStr === undefined &&
        metadata['auto_context'] !== undefined &&
        metadata['auto_context'] !== null
    ) {
        autoContextStr =
            typeof metadata['auto_context'] === 'string'
                ? metadata['auto_context']
                : JSON.stringify(metadata['auto_context'])
    } else if (
        autoContextStr === undefined &&
        metadata['autoContext'] !== undefined &&
        metadata['autoContext'] !== null
    ) {
        autoContextStr =
            typeof metadata['autoContext'] === 'string'
                ? metadata['autoContext']
                : JSON.stringify(metadata['autoContext'])
    }

    let relationships: { target_id: number; relation_type: string }[]
    if (
        metadata['relationships'] !== undefined &&
        metadata['relationships'] !== null &&
        Array.isArray(metadata['relationships'])
    ) {
        relationships = metadata['relationships']
            .map((r: unknown) => {
                const rec = r != null ? z.record(z.string(), z.unknown()).parse(r) : null
                return {
                    target_id: Number(rec?.['target_id']),
                    relation_type: String(rec?.['relation_type']),
                }
            })
            .filter(
                (r) =>
                    !isNaN(r.target_id) &&
                    Boolean(r.relation_type) &&
                    r.relation_type !== 'undefined'
            )
    } else {
        relationships = parseRelationships(options.relationships, options.relFile)
    }

    let relatedIds = parseRelatedTo(options.relatedTo)
    if (relatedIds.length === 0 && Array.isArray(metadata['related_to'])) {
        relatedIds = metadata['related_to'].map(Number).filter((n) => !isNaN(n))
    }

    return {
        entryType,
        tags,
        projectNumber,
        workspaceId,
        trustScore,
        impactScore,
        validationStatus,
        sessionId,
        autoContextStr,
        relationships,
        relatedIds,
    }
}
