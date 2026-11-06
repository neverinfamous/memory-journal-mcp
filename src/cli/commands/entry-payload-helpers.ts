import { readFileSync } from 'node:fs'
import { z } from 'zod'

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
            process.stderr.write(
                `Warning: Failed to read --auto-context-file: ${e instanceof Error ? e.message : String(e)}\n`
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
