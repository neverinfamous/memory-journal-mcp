import { readFileSync } from 'node:fs'
import { z } from 'zod'
import type { EntryType, RelationshipType } from '../../types/index.js'
import { ENTRY_TYPES, RELATIONSHIP_TYPES } from '../../types/entities.js'
import { ValidationError } from '../../types/errors.js'
import type { createEntryOptionsSchema } from '../schemas.js'

export type HealedEntryOptions = z.infer<typeof createEntryOptionsSchema> & {
    tag?: string
    contentFile?: string
    body?: string
}

/** Normalize CLI flag aliases (--tag, --content-file, --body, --validation, --workspace, --summary, --description) and positional content. */
export function applyCliEntryFlagAliases(
    options: HealedEntryOptions,
    restArgs: unknown[] = []
): void {
    if (
        options.workspace !== undefined &&
        options.workspaceId === undefined &&
        options.workspace.trim() !== ''
    ) {
        options.workspaceId = options.workspace
    }
    if (
        options.workspace_id !== undefined &&
        options.workspaceId === undefined &&
        options.workspace_id.trim() !== ''
    ) {
        options.workspaceId = options.workspace_id
    }
    if (options.tag !== undefined && options.tags === undefined) options.tags = options.tag
    if (options.contentFile !== undefined && options.file === undefined) {
        options.file = options.contentFile
    }
    if (options.body !== undefined && options.content === undefined) options.content = options.body
    if (options.validation !== undefined && options.validationStatus === undefined) {
        options.validationStatus = options.validation
    }
    if (options.validation_status !== undefined && options.validationStatus === undefined) {
        options.validationStatus = options.validation_status
    }

    if (options.content === undefined && options.file === undefined && restArgs.length > 0) {
        const rawParts: unknown[] = []
        for (const arg of restArgs) {
            if (Array.isArray(arg)) {
                for (const item of arg) rawParts.push(item)
            } else {
                rawParts.push(arg)
            }
        }
        const positionalParts = rawParts.filter(
            (arg): arg is string => typeof arg === 'string' && arg.trim() !== ''
        )
        if (positionalParts.length > 0) {
            options.content = positionalParts.join(' ')
        }
    }
    if (
        options.description !== undefined &&
        options.content === undefined &&
        options.file === undefined
    ) {
        options.content = options.description
    }
    if (
        options.summary !== undefined &&
        options.content === undefined &&
        options.file === undefined
    ) {
        options.content = options.summary
    } else if (options.summary !== undefined && options.title === undefined) {
        options.title = options.summary
    }
}

/**
 * Pure helpers for resolving entry payload fields from CLI options and metadata.
 * Extracted from buildEntryPayload.
 */

const PASSED_STATUSES = ['passed', 'pass', 'success', 'ok', 'validated', 'valid', 'verified', 'true', '1']
const FAILED_STATUSES = ['failed', 'fail', 'error', 'failing', 'false', '0']

/** Normalise boolean/string/number validation inputs to passed | failed | none. */
export function normalizeValidationStatus(
    valStatusRaw: unknown
): 'passed' | 'failed' | 'none' | undefined {
    if (valStatusRaw === undefined || valStatusRaw === null) return undefined
    if (typeof valStatusRaw === 'boolean') return valStatusRaw ? 'passed' : 'failed'
    if (typeof valStatusRaw === 'string') {
        const lower = valStatusRaw.trim().toLowerCase()
        if (PASSED_STATUSES.includes(lower)) return 'passed'
        if (FAILED_STATUSES.includes(lower)) return 'failed'
        return 'none'
    }
    if (typeof valStatusRaw === 'number') {
        return valStatusRaw === 1 ? 'passed' : valStatusRaw === 0 ? 'failed' : 'none'
    }
    return undefined
}

function stringifyMetadataValue(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value)
}

/** Auto-context from CLI option, --auto-context-file, or metadata (auto_context / autoContext). */
export function resolveAutoContext(
    autoContext: string | undefined,
    autoContextFile: string | undefined,
    metadata: Record<string, unknown>
): string | undefined {
    let autoContextStr = autoContext
    if (autoContextFile) {
        try {
            autoContextStr = readFileSync(autoContextFile, 'utf-8')
        } catch (e) {
            throw new Error(
                `Failed to read --auto-context-file: ${e instanceof Error ? e.message : String(e)}`,
                { cause: e }
            )
        }
    } else if (
        autoContextStr === undefined &&
        metadata['auto_context'] !== undefined &&
        metadata['auto_context'] !== null
    ) {
        autoContextStr = stringifyMetadataValue(metadata['auto_context'])
    } else if (
        autoContextStr === undefined &&
        metadata['autoContext'] !== undefined &&
        metadata['autoContext'] !== null
    ) {
        autoContextStr = stringifyMetadataValue(metadata['autoContext'])
    }
    return autoContextStr
}

/** Relationships declared inside a metadata array; invalid targets/types are dropped. */
export function relationshipsFromMetadata(
    raw: unknown[]
): { target_id: number; relation_type: RelationshipType }[] {
    return raw.flatMap((r: unknown) => {
        const rec = r != null ? z.record(z.string(), z.unknown()).parse(r) : null
        const targetId = Number(rec?.['target_id'])
        const relType = relationTypeSchema.safeParse(rec?.['relation_type'])
        return !isNaN(targetId) && relType.success
            ? [{ target_id: targetId, relation_type: relType.data }]
            : []
    })
}

export const relationTypeSchema = z.enum(RELATIONSHIP_TYPES)
export const entryTypeSchema = z.enum(ENTRY_TYPES)

export function resolveEntryTypeAndTags(
    options: z.infer<typeof createEntryOptionsSchema>,
    metadata: Record<string, unknown>
): { entryType: EntryType | undefined; tags: string[] | undefined } {
    const entryTypeStr: unknown =
        options.type ??
        options.category ??
        metadata['type'] ??
        metadata['entry_type'] ??
        metadata['entryType']
    let entryType: EntryType | undefined
    if (entryTypeStr !== undefined && entryTypeStr !== null) {
        const parsed = entryTypeSchema.safeParse(entryTypeStr)
        if (!parsed.success) {
            throw new Error(
                `Invalid entry_type '${typeof entryTypeStr === 'string' ? entryTypeStr : JSON.stringify(entryTypeStr)}'. Expected one of: ${ENTRY_TYPES.join(', ')}`
            )
        }
        entryType = parsed.data
    }

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
    return { entryType, tags }
}

function parseStrictPositiveProjectNumber(raw: unknown): number | undefined {
    if (raw === undefined || raw === null) return undefined
    if (typeof raw === 'number') {
        if (!Number.isInteger(raw) || raw < 1) {
            throw new Error(
                `Invalid project number '${String(raw)}'. Expected a positive integer.`
            )
        }
        return raw
    }
    if (typeof raw !== 'string') {
        throw new Error('Invalid project number. Expected a positive integer.')
    }
    const trimmed = raw.trim()
    if (trimmed === '') return undefined
    const match = /^p?(\d+)$/i.exec(trimmed)
    if (match === null) {
        throw new Error(
            `Invalid project number '${trimmed}'. Expected a positive integer.`
        )
    }
    const parsed = Number.parseInt(match[1] ?? '', 10)
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(
            `Invalid project number '${trimmed}'. Expected a positive integer.`
        )
    }
    return parsed
}

export function resolveExplicitProjectAndWorkspace(
    options: HealedEntryOptions,
    metadata: Record<string, unknown>
): { explicitProjectNum: number | undefined; explicitWorkspaceId: string | undefined } {
    const projectRaw =
        options.project ??
        options.projectNumber ??
        options.project_number ??
        metadata['project'] ??
        metadata['projectNumber'] ??
        metadata['project_number']
    const explicitProjectNum = parseStrictPositiveProjectNumber(projectRaw)

    const optsRec = z.record(z.string(), z.unknown()).parse(options)
    const rawWs =
        optsRec['workspaceId'] ??
        optsRec['workspace_id'] ??
        optsRec['workspace'] ??
        metadata['workspace'] ??
        metadata['workspaceId'] ??
        metadata['workspace_id']
    const explicitWorkspaceId =
        typeof rawWs === 'string' && rawWs.trim() !== '' ? rawWs.trim() : undefined
    if (explicitWorkspaceId === '*') {
        throw new ValidationError(
            "Workspace '*' cannot be used for entry writes. Pass a concrete workspace.",
            { workspaceId: '*' }
        )
    }
    return { explicitProjectNum, explicitWorkspaceId }
}

export function resolveScoresAndValidation(
    options: z.infer<typeof createEntryOptionsSchema>,
    metadata: Record<string, unknown>
): {
    trustScore: number | undefined
    impactScore: number | undefined
    validationStatus: 'passed' | 'failed' | 'none' | undefined
    sessionId: string | undefined
} {
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
    const validationStatus = normalizeValidationStatus(valStatusRaw)

    const sessionIdRaw =
        options.sessionId ?? options.session_id ?? metadata['session_id'] ?? metadata['sessionId']
    const sessionId = sessionIdRaw as string | undefined

    return { trustScore, impactScore, validationStatus, sessionId }
}
