import { readFileSync } from 'node:fs'
import { z } from 'zod'
import type { EntryType } from '../../types/index.js'
import type { createEntryOptionsSchema } from '../schemas.js'

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
): { target_id: number; relation_type: string }[] {
    return raw
        .map((r: unknown) => {
            const rec = r != null ? z.record(z.string(), z.unknown()).parse(r) : null
            return {
                target_id: Number(rec?.['target_id']),
                relation_type: String(rec?.['relation_type']),
            }
        })
        .filter(
            (r) =>
                !isNaN(r.target_id) && Boolean(r.relation_type) && r.relation_type !== 'undefined'
        )
}

export function resolveEntryTypeAndTags(
    options: z.infer<typeof createEntryOptionsSchema>,
    metadata: Record<string, unknown>
): { entryType: EntryType | undefined; tags: string[] | undefined } {
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
    return { entryType, tags }
}

export function resolveExplicitProjectAndWorkspace(
    options: z.infer<typeof createEntryOptionsSchema>,
    metadata: Record<string, unknown>
): { explicitProjectNum: number | undefined; explicitWorkspaceId: string | undefined } {
    const projectRaw =
        options.project ??
        options.projectNumber ??
        options.project_number ??
        metadata['project'] ??
        metadata['projectNumber'] ??
        metadata['project_number']
    const parsedProjectNum = projectRaw !== undefined ? Number(projectRaw) : undefined
    const explicitProjectNum =
        parsedProjectNum !== undefined && !isNaN(parsedProjectNum) ? parsedProjectNum : undefined

    const optsRec = z.record(z.string(), z.unknown()).parse(options)
    const rawWs =
        optsRec['workspaceId'] ??
        optsRec['workspace_id'] ??
        metadata['workspace'] ??
        metadata['workspaceId'] ??
        metadata['workspace_id']
    const explicitWorkspaceId = typeof rawWs === 'string' ? rawWs : undefined
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
