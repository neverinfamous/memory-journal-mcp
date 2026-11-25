/**
 * Context-field payload recovery and entry telemetry helpers extracted from `payload-synthesizer.ts`.
 */

import { appendOptionalQuerySearchFields } from '../../../codemode/shared-context-parsers.js'
import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { extractAndRecoverRecordCode } from './json-entry-recovery.js'
import { hasUseTestDbFlag } from './json-entry-scope.js'
import { hasStructuredDiscriminator } from './json-entry-structured.js'
import {
    appendSharedEntryFlags,
    getNonEmptyString,
    parsePositiveEntryId,
    resolveCompatibleInheritedScope,
} from './natural-language-synthesizer.js'

const MAX_RECOVERED_CONTEXT_CODE_BYTES = 50 * 1024

function recoveryValidationFailure(error: string): { earlyReturn: Record<string, unknown> } {
    return {
        earlyReturn: {
            success: false,
            error,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: true,
            project_id: undefined,
            executionTimeMs: 0,
        },
    }
}

function oversizedContextFailure(): { earlyReturn: Record<string, unknown> } {
    return recoveryValidationFailure(
        `Recovered context code exceeds maximum length of ${String(MAX_RECOVERED_CONTEXT_CODE_BYTES)} bytes.`
    )
}

export function appendEntryTelemetryFields(
    payload: Record<string, unknown>,
    primary: Record<string, unknown>,
    secondary: Record<string, unknown>
): void {
    const sessVal = getNonEmptyString(primary, secondary, ['session_id', 'sessionId'])
    if (sessVal !== undefined) payload['session_id'] = sessVal
    const impactVal =
        primary['impact_score'] ?? primary['impactScore'] ?? primary['impact'] ??
        secondary['impact_score'] ?? secondary['impactScore'] ?? secondary['impact']
    if (typeof impactVal === 'number' && Number.isFinite(impactVal)) payload['impact_score'] = impactVal
    const trustVal =
        primary['trust_score'] ?? primary['trustScore'] ?? primary['trust'] ??
        secondary['trust_score'] ?? secondary['trustScore'] ?? secondary['trust']
    if (typeof trustVal === 'number' && Number.isFinite(trustVal)) payload['trust_score'] = trustVal
    const valStatus = getNonEmptyString(primary, secondary, ['validation_status', 'validationStatus', 'validation'])
    if (valStatus !== undefined) payload['validation_status'] = valStatus
    const autoCtx =
        primary['auto_context'] ?? primary['autoContext'] ??
        secondary['auto_context'] ?? secondary['autoContext']
    if (autoCtx !== undefined) payload['auto_context'] = autoCtx
    appendSharedEntryFlags(payload, primary, secondary)
}

function synthesizeContextEntryCall(
    ctxVal: Record<string, unknown>,
    outerFallback: Record<string, unknown>,
    rawBody: string,
    wsVal: string | undefined,
    projVal: number | string | undefined
): string | { earlyReturn: Record<string, unknown> } {
    if (Buffer.byteLength(rawBody, 'utf-8') > MAX_RECOVERED_CONTEXT_CODE_BYTES) {
        return oversizedContextFailure()
    }
    const numericEntryId = parsePositiveEntryId(ctxVal, outerFallback)
    const isUpdate = numericEntryId !== undefined
    const explicitTitle = getNonEmptyString(ctxVal, {}, ['title'])
    const explicitType = getNonEmptyString(ctxVal, {}, ['type', 'entry_type', 'category'])
    const entryPayload: Record<string, unknown> = { content: rawBody }
    if (!isUpdate || explicitTitle !== undefined) {
        entryPayload['title'] = explicitTitle ?? 'Journal Entry'
    }
    if (explicitType !== undefined) entryPayload['entry_type'] = explicitType
    else if (!isUpdate) entryPayload['entry_type'] = 'technical_note'
    const rawTagsVal = ctxVal['tags'] !== undefined ? ctxVal['tags'] : outerFallback['tags']
    if (Array.isArray(rawTagsVal)) {
        const cleanTags = rawTagsVal.filter((t): t is string => typeof t === 'string')
        if (cleanTags.length > 0 || isUpdate || rawTagsVal === ctxVal['tags']) {
            entryPayload['tags'] = cleanTags
        }
    }
    if (numericEntryId !== undefined) entryPayload['entry_id'] = numericEntryId
    if (wsVal !== undefined) entryPayload['workspace_id'] = wsVal
    if (projVal !== undefined) entryPayload['project_number'] = projVal
    appendEntryTelemetryFields(entryPayload, ctxVal, outerFallback)
    const fnName = isUpdate ? 'mj.updateEntry' : 'mj.createEntry'
    const synthesized = `return await ${fnName}(${JSON.stringify(entryPayload)});`
    return Buffer.byteLength(synthesized, 'utf-8') <= MAX_RECOVERED_CONTEXT_CODE_BYTES
        ? synthesized
        : oversizedContextFailure()
}

export function recoverFromContextField(
    ctxVal: unknown,
    outerParams?: Record<string, unknown>,
    unrecoverableMessage = 'Could not recover executable code from the supplied payload/entry. Pass JavaScript in `code` (e.g. `return await mj.core.createEntry({...})`).'
): string | { earlyReturn: Record<string, unknown> } | undefined {
    if (typeof ctxVal === 'string' && ctxVal.trim().length > 0) {
        return Buffer.byteLength(ctxVal, 'utf-8') <= MAX_RECOVERED_CONTEXT_CODE_BYTES
            ? ctxVal
            : oversizedContextFailure()
    }
    if (!isRecord(ctxVal)) return undefined

    if (typeof ctxVal['code'] === 'string' && ctxVal['code'].trim().length > 0) {
        return Buffer.byteLength(ctxVal['code'], 'utf-8') <= MAX_RECOVERED_CONTEXT_CODE_BYTES
            ? ctxVal['code']
            : oversizedContextFailure()
    }
    if (typeof ctxVal['script'] === 'string' && ctxVal['script'].trim().length > 0) {
        return Buffer.byteLength(ctxVal['script'], 'utf-8') <= MAX_RECOVERED_CONTEXT_CODE_BYTES
            ? ctxVal['script']
            : oversizedContextFailure()
    }
    const outerFallback = outerParams ?? {}
    if (hasStructuredDiscriminator(ctxVal)) {
        const recoveredCtx = extractAndRecoverRecordCode(ctxVal, outerParams)
        return recoveredCtx ?? recoveryValidationFailure(unrecoverableMessage)
    }
    const { wsVal, projVal } = resolveCompatibleInheritedScope(ctxVal, outerFallback)
    if (typeof ctxVal['query'] === 'string' && ctxVal['query'].trim().length > 0) {
        if (Buffer.byteLength(ctxVal['query'], 'utf-8') > MAX_RECOVERED_CONTEXT_CODE_BYTES) {
            return oversizedContextFailure()
        }
        const searchPayload: Record<string, unknown> = { query: ctxVal['query'] }
        if (wsVal !== undefined) searchPayload['workspace_id'] = wsVal
        if (projVal !== undefined) searchPayload['project_number'] = projVal
        if (hasUseTestDbFlag(ctxVal, outerFallback)) searchPayload['use_test_db'] = true
        appendOptionalQuerySearchFields(searchPayload, ctxVal, outerFallback['limit'])
        const synthesized = `return await mj.searchEntries(${JSON.stringify(searchPayload)});`
        return Buffer.byteLength(synthesized, 'utf-8') <= MAX_RECOVERED_CONTEXT_CODE_BYTES
            ? synthesized
            : oversizedContextFailure()
    }
    const rawBody =
        typeof ctxVal['content'] === 'string'
            ? ctxVal['content']
            : typeof ctxVal['instructions'] === 'string'
              ? ctxVal['instructions']
              : undefined
    if (rawBody !== undefined && rawBody.trim().length > 0) {
        return synthesizeContextEntryCall(ctxVal, outerFallback, rawBody, wsVal, projVal)
    }
    return undefined
}
