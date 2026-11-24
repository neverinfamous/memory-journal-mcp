import { z } from 'zod'
import type { EntryType, RelationshipType, SignificanceType } from '../../types/index.js'
import { ENTRY_TYPES, RELATIONSHIP_TYPES, SIGNIFICANCE_TYPES } from '../../types/entities.js'
import { ValidationError } from '../../types/errors.js'
import {
    RELATIONSHIP_TARGET_KEYS,
    RELATIONSHIP_TYPE_KEYS,
    normalizeSignificanceValue,
    pickRecordField,
} from '../../handlers/tools/schemas/constants-and-primitives.js'
import type { createEntryOptionsSchema } from '../schemas.js'
import { parsePositiveProjectNumber } from '../../utils/safe-positive-int.js'
import { readBoundedCliInputFile } from './cli-input-reader.js'

const POSITIVE_INT_RE = /^[1-9]\d*$/
const TAG_SPLIT_RE = /[,\s]+/
const PROJECT_PREFIX_RE = /^p/i
const PREFIXED_POSITIVE_INT_RE = /^p?[1-9]\d*$/i

export const CLI_MAX_CONTENT_LENGTH = 50_000

/** Enforce 1..50,000 non-empty content bounds matching MCP Create/UpdateEntrySchema. */
export function validateCliEntryContent(content: string): void {
    if (content.trim().length === 0) {
        throw new ValidationError('Entry content cannot be empty.', { minLength: 1 })
    }
    if (content.length > CLI_MAX_CONTENT_LENGTH) {
        throw new ValidationError(
            `Entry content exceeds maximum length of ${String(CLI_MAX_CONTENT_LENGTH)} characters.`,
            { maxLength: CLI_MAX_CONTENT_LENGTH, actualLength: content.length }
        )
    }
}

export type HealedEntryOptions = z.infer<typeof createEntryOptionsSchema> & {
    tag?: string
    contentFile?: string
    body?: string
}

/** Normalize CLI flag aliases (--tag, --content-file, --body, --validation, --significance, --workspace, --summary, --description) and positional content. */
export function applyCliEntryFlagAliases(
    options: HealedEntryOptions,
    restArgs: unknown[] = []
): void {
    if (
        options.workspace_id !== undefined &&
        options.workspaceId === undefined &&
        options.workspace_id.trim() !== ''
    ) {
        options.workspaceId = options.workspace_id
    }
    if (
        options.workspace !== undefined &&
        options.workspaceId === undefined &&
        options.workspace.trim() !== ''
    ) {
        options.workspaceId = options.workspace
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
    if (options.significance !== undefined && options.significanceType === undefined) {
        options.significanceType = options.significance
    }
    if (options.significance_type !== undefined && options.significanceType === undefined) {
        options.significanceType = options.significance_type
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
    if (options.summary !== undefined && options.title === undefined) {
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
    if (autoContextFile !== undefined) {
        try {
            autoContextStr = readBoundedCliInputFile(autoContextFile, '--auto-context-file')
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

export const UNKNOWN_RECORD_SCHEMA = z.record(z.string(), z.unknown())

const CLI_RELATION_TYPE_ALIASES: Readonly<Record<string, RelationshipType>> = {
    resolves: 'resolved',
    depends_on: 'blocked_by',
    relates_to: 'references',
}

/** Parse and validate relationship objects (`target_id` / `targetId` / aliases + `relation_type` / `relationType` / aliases). */
export function parseRelationshipArray(
    raw: unknown[],
    source: string
): { target_id: number; relation_type: RelationshipType }[] {
    return raw.map((r: unknown, index: number) => {
        if (typeof r !== 'object' || r === null || Array.isArray(r)) {
            throw new ValidationError(
                `Invalid relationship at index ${String(index)} in ${source}: expected an object with target_id and relation_type.`
            )
        }
        const rec = UNKNOWN_RECORD_SCHEMA.parse(r)
        const rawTarget = pickRecordField(rec, RELATIONSHIP_TARGET_KEYS)
        const trimmedTarget = typeof rawTarget === 'string' ? rawTarget.trim() : undefined
        const targetId =
            typeof rawTarget === 'number'
                ? rawTarget
                : trimmedTarget !== undefined && POSITIVE_INT_RE.test(trimmedTarget)
                  ? Number(trimmedTarget)
                  : Number.NaN
        if (
            !Number.isSafeInteger(targetId) ||
            targetId < 1 ||
            (trimmedTarget !== undefined && String(targetId) !== trimmedTarget)
        ) {
            throw new ValidationError(
                `Invalid relationship target_id '${String(rawTarget)}' at index ${String(index)} in ${source}: expected a positive integer.`
            )
        }
        const rawRelType = pickRecordField(rec, RELATIONSHIP_TYPE_KEYS)
        const trimmedRelType = typeof rawRelType === 'string' ? rawRelType.trim().toLowerCase() : ''
        const normalizedRelType =
            typeof rawRelType === 'string'
                ? Object.hasOwn(CLI_RELATION_TYPE_ALIASES, trimmedRelType)
                    ? CLI_RELATION_TYPE_ALIASES[trimmedRelType]
                    : rawRelType.trim()
                : rawRelType
        const relType = relationTypeSchema.safeParse(normalizedRelType)
        if (!relType.success) {
            throw new ValidationError(
                `Invalid relation_type '${String(rawRelType)}' at index ${String(index)} in ${source}. Expected one of: ${relationTypeSchema.options.join(', ')}`
            )
        }
        return { target_id: targetId, relation_type: relType.data }
    })
}

/** Relationships declared inside a metadata array; throws ValidationError on invalid targets/types. */
export function relationshipsFromMetadata(
    raw: unknown[]
): { target_id: number; relation_type: RelationshipType }[] {
    return parseRelationshipArray(raw, '--metadata relationships')
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
            .split(TAG_SPLIT_RE)
            .map((t) => t.trim())
            .filter(Boolean)
    } else if (metadata['tags'] !== undefined && metadata['tags'] !== null) {
        tags = Array.isArray(metadata['tags']) ? metadata['tags'].map(String) : undefined
    }
    return { entryType, tags }
}

function parseStrictPositiveProjectNumber(raw: unknown): number | undefined {
    if (raw === undefined || raw === null) return undefined
    if (typeof raw !== 'string' && typeof raw !== 'number') {
        throw new Error('Invalid project number. Expected a positive integer.')
    }
    if (typeof raw === 'string' && raw.trim() === '') return undefined
    const canonicalSource = typeof raw === 'string' ? raw.trim().replace(PROJECT_PREFIX_RE, '') : raw
    const parsed = parsePositiveProjectNumber(canonicalSource)
    if (parsed === undefined || (typeof raw === 'string' && !PREFIXED_POSITIVE_INT_RE.test(raw.trim()))) {
        throw new Error(`Invalid project number '${String(raw)}'. Expected a positive integer.`)
    }
    return parsed
}

export function firstNonBlankString(...values: readonly unknown[]): string | undefined {
    for (const val of values) {
        if (typeof val === 'string' && val.trim().length > 0) {
            return val.trim()
        }
    }
    return undefined
}

function firstDefinedProjectRaw(...values: readonly unknown[]): unknown {
    for (const val of values) {
        if (val === undefined || val === null) continue
        if (typeof val === 'string' && val.trim().length === 0) continue
        return val
    }
    return undefined
}

export function resolveExplicitProjectAndWorkspace(
    options: HealedEntryOptions,
    metadata: Record<string, unknown>
): { explicitProjectNum: number | undefined; explicitWorkspaceId: string | undefined } {
    const projectRaw = firstDefinedProjectRaw(
        options.project,
        options.projectNumber,
        options.project_number,
        metadata['project'],
        metadata['projectNumber'],
        metadata['project_number']
    )
    const explicitProjectNum = parseStrictPositiveProjectNumber(projectRaw)

    const optsRec = UNKNOWN_RECORD_SCHEMA.parse(options)
    const explicitWorkspaceId = firstNonBlankString(
        optsRec['workspaceId'],
        optsRec['workspace_id'],
        optsRec['workspace'],
        metadata['workspace_id'],
        metadata['workspaceId'],
        metadata['workspace']
    )
    if (explicitWorkspaceId === '*') {
        throw new ValidationError(
            "Workspace '*' cannot be used for entry writes. Pass a concrete workspace.",
            { workspaceId: '*' }
        )
    }
    return { explicitProjectNum, explicitWorkspaceId }
}

function resolveSignificanceType(
    options: z.infer<typeof createEntryOptionsSchema>,
    metadata: Record<string, unknown>
): SignificanceType | undefined {
    const sigRaw =
        options.significanceType ??
        options.significance ??
        options.significance_type ??
        metadata['significance_type'] ??
        metadata['significanceType'] ??
        metadata['significance']
    if (typeof sigRaw !== 'string' || sigRaw.trim() === '') return undefined
    const normalized = normalizeSignificanceValue(sigRaw)
    if (normalized === undefined) return undefined
    if (!SIGNIFICANCE_TYPES.some((t) => t === normalized)) {
        throw new ValidationError(
            `Invalid significance_type '${sigRaw}'. Expected one of: ${SIGNIFICANCE_TYPES.join(', ')}`
        )
    }
    return normalized as SignificanceType
}

const CANONICAL_SCORE_RE = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/

function parseStrictUnitScore(raw: unknown, label: string): number | undefined {
    if (raw === undefined || raw === null) return undefined
    let parsed: number
    if (typeof raw === 'number') {
        parsed = raw
    } else if (typeof raw === 'string') {
        const trimmed = raw.trim()
        parsed = CANONICAL_SCORE_RE.test(trimmed) ? Number(trimmed) : Number.NaN
    } else {
        parsed = Number.NaN
    }
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
        const display =
            typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean'
                ? String(raw)
                : JSON.stringify(raw)
        throw new ValidationError(
            `Invalid ${label} '${display}'. Expected a number between 0 and 1.`
        )
    }
    return parsed
}

export function resolveScoresAndValidation(
    options: z.infer<typeof createEntryOptionsSchema>,
    metadata: Record<string, unknown>
): {
    trustScore: number | undefined
    impactScore: number | undefined
    validationStatus: 'passed' | 'failed' | 'none' | undefined
    sessionId: string | undefined
    significanceType: SignificanceType | undefined
} {
    const trustRaw =
        options.trustScore ??
        options.trust_score ??
        options.confidence ??
        metadata['trust'] ??
        metadata['trustScore'] ??
        metadata['trust_score'] ??
        metadata['confidence']
    const trustScore = parseStrictUnitScore(trustRaw, 'trust/confidence score')

    const impactRaw =
        options.impactScore ??
        options.impact_score ??
        metadata['impact'] ??
        metadata['impactScore'] ??
        metadata['impact_score']
    const impactScore = parseStrictUnitScore(impactRaw, 'impact score')

    const valStatusRaw =
        options.validationStatus ??
        options.validation_status ??
        options.validation ??
        metadata['validation_status'] ??
        metadata['validationStatus'] ??
        metadata['validation']
    const validationStatus = normalizeValidationStatus(valStatusRaw)

    const sessionIdRaw: unknown =
        options.sessionId ?? options.session_id ?? metadata['session_id'] ?? metadata['sessionId']
    const sessionId = typeof sessionIdRaw === 'string' ? sessionIdRaw : undefined

    return {
        trustScore,
        impactScore,
        validationStatus,
        sessionId,
        significanceType: resolveSignificanceType(options, metadata),
    }
}
