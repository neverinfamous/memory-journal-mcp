import type { z } from 'zod'
import type { EntryType, SignificanceType } from '../../types/index.js'
import { ENTRY_TYPES, SIGNIFICANCE_TYPES } from '../../types/entities.js'
import { ValidationError } from '../../types/errors.js'
import { normalizeSignificanceValue } from '../../handlers/tools/schemas/constants-and-primitives.js'
import { createEntryOptionsSchema } from '../schemas.js'
import { parsePositiveProjectNumber } from '../../utils/safe-positive-int.js'
import { isRecord } from '../../utils/type-guards.js'
import { readBoundedCliInputFile } from './cli-input-reader.js'
import {
    CLI_MAX_CONTENT_LENGTH,
    UNKNOWN_RECORD_SCHEMA,
    entryTypeSchema,
    firstNonBlankString,
    normalizeValidationStatus,
    parseRelationshipArray,
    relationTypeSchema,
    relationshipsFromMetadata,
    validateCliEntryContent,
} from './entry-payload-parsers.js'

export {
    CLI_MAX_CONTENT_LENGTH,
    UNKNOWN_RECORD_SCHEMA,
    entryTypeSchema,
    firstNonBlankString,
    normalizeValidationStatus,
    parseRelationshipArray,
    relationTypeSchema,
    relationshipsFromMetadata,
    validateCliEntryContent,
}

const TAG_SPLIT_RE = /[,\s]+/
const PROJECT_PREFIX_RE = /^p/i
const PREFIXED_POSITIVE_INT_RE = /^p?[1-9]\d*$/i

export type HealedEntryOptions = z.infer<typeof createEntryOptionsSchema> & {
    tag?: string | undefined
    contentFile?: string | undefined
    body?: string | undefined
}

export function extractLooseCliOptions<T extends z.ZodRawShape>(
    schema: z.ZodObject<T>,
    raw: unknown
): z.infer<ReturnType<z.ZodObject<T>['loose']>> {
    const looseSchema = schema.loose()
    if (!isRecord(raw)) {
        return looseSchema.parse({})
    }
    const parsed = looseSchema.safeParse(raw)
    if (parsed.success) {
        return parsed.data
    }
    const cleaned: Record<string, unknown> = { ...raw }
    for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (typeof key === 'string') {
            Reflect.deleteProperty(cleaned, key)
        }
    }
    return looseSchema.parse(cleaned)
}

/** Reject unrecognized CLI validation flags stripped during loose option extraction. */
export function assertNoInvalidCliValidationOption(
    raw: unknown,
    extracted: Record<string, unknown>
): void {
    if (!isRecord(raw)) return
    for (const k of ['validationStatus', 'validation_status', 'validation'] as const) {
        const rawVal = raw[k]
        if (rawVal !== undefined && rawVal !== null && rawVal !== '' && extracted[k] === undefined) {
            normalizeValidationStatus(rawVal)
        }
    }
}

export function extractHealedEntryOptions(raw: unknown): HealedEntryOptions {
    const out: HealedEntryOptions = { ...extractLooseCliOptions(createEntryOptionsSchema, raw) }
    if (isRecord(raw)) {
        if (typeof raw['tag'] === 'string') out.tag = raw['tag']
        if (typeof raw['contentFile'] === 'string') out.contentFile = raw['contentFile']
        if (typeof raw['body'] === 'string') out.body = raw['body']
        assertNoInvalidCliValidationOption(raw, out)
    }
    return out
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
        if (!Array.isArray(metadata['tags'])) {
            throw new ValidationError('Invalid metadata.tags: expected an array of non-empty strings.')
        }
        tags = metadata['tags'].map((t, idx) => {
            if (typeof t !== 'string' || t.trim().length === 0) {
                throw new ValidationError(
                    `Invalid metadata.tags[${String(idx)}]: expected a non-empty string.`
                )
            }
            return t.trim()
        })
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
    const cliWsCandidates = [optsRec['workspaceId'], optsRec['workspace_id'], optsRec['workspace']]
    for (const candidate of cliWsCandidates) {
        if (typeof candidate === 'string' && candidate.trim() === '') {
            throw new ValidationError('Workspace cannot be blank.')
        }
    }
    const explicitWorkspaceId = firstNonBlankString(
        ...cliWsCandidates,
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
    const matched = SIGNIFICANCE_TYPES.find((t) => t === normalized)
    if (matched === undefined) {
        throw new ValidationError(
            `Invalid significance_type '${sigRaw}'. Expected one of: ${SIGNIFICANCE_TYPES.join(', ')}`
        )
    }
    return matched
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

    for (const cliSession of [options.sessionId, options.session_id]) {
        if (typeof cliSession === 'string' && cliSession.trim() === '') {
            throw new ValidationError('Session ID cannot be blank.')
        }
    }
    const sessionId = firstNonBlankString(
        options.sessionId,
        options.session_id,
        metadata['session_id'],
        metadata['sessionId']
    )

    return {
        trustScore,
        impactScore,
        validationStatus,
        sessionId,
        significanceType: resolveSignificanceType(options, metadata),
    }
}
