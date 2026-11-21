/**
 * Anchor field healers extracted from hallucination-healer-fields.ts.
 */

const ANCHOR_STATUS_ALIAS_MAP: Record<
    string,
    'pending' | 'valid' | 'stale' | 'invalidated' | 'unresolvable'
> = {
    pending: 'pending',
    valid: 'valid',
    active: 'valid',
    current: 'valid',
    ok: 'valid',
    verified: 'valid',
    clean: 'valid',
    fresh: 'valid',
    stale: 'stale',
    outdated: 'stale',
    modified: 'stale',
    dirty: 'stale',
    invalidated: 'invalidated',
    invalid: 'invalidated',
    deleted: 'invalidated',
    removed: 'invalidated',
    missing: 'invalidated',
    unresolvable: 'unresolvable',
    unresolved: 'unresolvable',
}

export function coerceAnchorStatusAlias(
    raw: unknown
): 'pending' | 'valid' | 'stale' | 'invalidated' | 'unresolvable' | undefined {
    if (typeof raw !== 'string') return undefined
    const normalized = raw.trim().toLowerCase()
    return Object.hasOwn(ANCHOR_STATUS_ALIAS_MAP, normalized)
        ? ANCHOR_STATUS_ALIAS_MAP[normalized]
        : undefined
}

function normalizeAnchorContainer(obj: Record<string, unknown>): boolean {
    let modified = false
    for (const aliasKey of ['anchor', 'file_anchors', 'fileAnchors'] as const) {
        if (aliasKey in obj) {
            if (!('anchors' in obj) && obj[aliasKey] !== undefined) {
                obj['anchors'] = obj[aliasKey]
            }
            Reflect.deleteProperty(obj, aliasKey)
            modified = true
        }
    }
    if (!('anchors' in obj) || obj['anchors'] === undefined || obj['anchors'] === null) {
        return modified
    }
    if (typeof obj['anchors'] === 'string') {
        const trimmed = obj['anchors'].trim()
        if (trimmed === '') {
            delete obj['anchors']
            return true
        }
        obj['anchors'] = [trimmed]
        modified = true
    }
    if (typeof obj['anchors'] === 'object' && !Array.isArray(obj['anchors'])) {
        const anchorRecord = obj['anchors'] as Record<string, unknown>
        const nestedArray =
            anchorRecord['files'] ??
            anchorRecord['paths'] ??
            anchorRecord['items'] ??
            anchorRecord['anchors']
        obj['anchors'] = Array.isArray(nestedArray) ? nestedArray : [anchorRecord]
        modified = true
    }
    return modified
}

function normalizeSingleAnchorItem(
    item: unknown
): { drop?: boolean; value?: unknown; changed: boolean } {
    if (typeof item === 'string') {
        const trimmed = item.trim()
        if (trimmed === '') return { drop: true, changed: true }
        const normalizedAnchor = trimmed.replace(/\\/g, '/')
        return {
            value: {
                anchor_path: normalizedAnchor,
                anchor_type: normalizedAnchor.includes('#') ? 'symbol' : 'file',
                status: 'pending',
            },
            changed: true,
        }
    }
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return { value: item, changed: false }
    }
    const itemObj = item as Record<string, unknown>
    const rawPath =
        itemObj['anchor_path'] ??
        itemObj['anchorPath'] ??
        itemObj['path'] ??
        itemObj['file'] ??
        itemObj['file_path'] ??
        itemObj['filepath'] ??
        itemObj['filePath'] ??
        itemObj['value'] ??
        itemObj['target'] ??
        itemObj['uri'] ??
        itemObj['location']
    const rawType = itemObj['anchor_type'] ?? itemObj['anchorType'] ?? itemObj['type']
    const rawStatus = itemObj['status']
    const normalizedPath =
        typeof rawPath === 'string' ? rawPath.trim().replace(/\\/g, '/') : undefined
    if (normalizedPath === undefined || normalizedPath === '') {
        return { value: item, changed: false }
    }
    const normalizedType =
        typeof rawType === 'string' && rawType.trim() !== ''
            ? rawType.trim()
            : normalizedPath.includes('#')
              ? 'symbol'
              : 'file'
    const mappedStatus =
        rawStatus !== undefined ? (coerceAnchorStatusAlias(rawStatus) ?? 'pending') : undefined
    const rebuilt: Record<string, unknown> = {
        anchor_path: normalizedPath,
        anchor_type: normalizedType,
        ...(mappedStatus !== undefined ? { status: mappedStatus } : {}),
    }
    const changed =
        itemObj['anchor_path'] !== rebuilt['anchor_path'] ||
        itemObj['anchor_type'] !== rebuilt['anchor_type'] ||
        itemObj['status'] !== rebuilt['status'] ||
        Object.keys(itemObj).length !== Object.keys(rebuilt).length
    return { value: rebuilt, changed }
}

/** Normalise string or aliased `anchors` payloads into `{ anchor_path, anchor_type, status }` items. */
export function healAnchorsField(obj: Record<string, unknown>): boolean {
    let modified = normalizeAnchorContainer(obj)
    if (!Array.isArray(obj['anchors'])) return modified

    const healedAnchors: unknown[] = []
    for (const item of obj['anchors']) {
        const outcome = normalizeSingleAnchorItem(item)
        if (outcome.changed) modified = true
        if (outcome.drop !== true) {
            healedAnchors.push(outcome.value)
        }
    }
    if (modified) {
        obj['anchors'] = healedAnchors
    }
    return modified
}
