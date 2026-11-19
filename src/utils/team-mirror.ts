/**
 * Personal ↔ team mirror detection.
 *
 * [INTENT] `create_entry({ share_with_team: true })` writes the same entry to the personal DB
 * and the team DB. Searches and briefings that merge both stores should show it once: keep
 * the personal hit and annotate it with `alsoInTeam: <teamId>`.
 *
 * Matching rules (`findMirroredPersonalId`):
 * 1. Precise: team `originPersonalId` (migration 020) equals a personal ID AND both rows share
 *    the workspace AND were created within MIRROR_TIMESTAMP_WINDOW_MS of each other. The
 *    timestamp/workspace checks guard against another member's unrelated personal row that
 *    happens to share the same numeric ID.
 * 2. Legacy fallback (no `originPersonalId`): sha256 of normalized content + workspace match.
 */

import { createHash } from 'node:crypto'

/** Max creation-time skew between a personal row and its team mirror (same request). */
export const MIRROR_TIMESTAMP_WINDOW_MS = 60_000

/** Minimal entry shape needed for mirror matching. */
export interface MirrorCandidate {
    readonly id: number
    readonly content: string
    readonly timestamp?: string | undefined
    readonly workspaceId?: string | null | undefined
    /** Team rows only: personal ID this row was mirrored from (NULL for legacy mirrors). */
    readonly originPersonalId?: number | null | undefined
}

/** Lookup index over the personal entries present in a merged result set. */
export interface PersonalMirrorIndex {
    readonly byId: ReadonlyMap<number, MirrorCandidate>
    readonly byContentKey: ReadonlyMap<string, number>
}

/** Normalize content for mirror hashing (line endings + whitespace runs). */
export function normalizeMirrorContent(content: string): string {
    return content.replace(/\r\n?/g, '\n').trim().replace(/\s+/g, ' ')
}

/** sha256(normalized content) scoped by workspace. */
export function mirrorContentKey(content: string, workspaceId: string | null | undefined): string {
    const digest = createHash('sha256').update(normalizeMirrorContent(content)).digest('hex')
    return `${workspaceId ?? ''}|${digest}`
}

/** Build a mirror index from the personal entries of a result set. */
export function buildPersonalMirrorIndex(
    personalEntries: readonly MirrorCandidate[]
): PersonalMirrorIndex {
    const byId = new Map<number, MirrorCandidate>()
    const byContentKey = new Map<string, number>()
    for (const entry of personalEntries) {
        byId.set(entry.id, entry)
        const key = mirrorContentKey(entry.content, entry.workspaceId)
        if (!byContentKey.has(key)) byContentKey.set(key, entry.id)
    }
    return { byId, byContentKey }
}

function withinMirrorWindow(a: string | undefined, b: string | undefined): boolean {
    if (a === undefined || b === undefined) return true
    const ta = Date.parse(a)
    const tb = Date.parse(b)
    if (Number.isNaN(ta) || Number.isNaN(tb)) return true
    return Math.abs(ta - tb) <= MIRROR_TIMESTAMP_WINDOW_MS
}

function sameWorkspace(a: string | null | undefined, b: string | null | undefined): boolean {
    return (a ?? '') === (b ?? '')
}

/** Return the personal entry ID a team row mirrors, or undefined. */
export function findMirroredPersonalId(
    teamEntry: MirrorCandidate,
    personal: PersonalMirrorIndex
): number | undefined {
    const origin = teamEntry.originPersonalId
    if (origin !== undefined && origin !== null) {
        const candidate = personal.byId.get(origin)
        if (
            candidate !== undefined &&
            sameWorkspace(candidate.workspaceId, teamEntry.workspaceId) &&
            withinMirrorWindow(candidate.timestamp, teamEntry.timestamp)
        ) {
            return candidate.id
        }
        // A stamped origin that does not match is authoritative: never fall back to content.
        return undefined
    }
    return personal.byContentKey.get(mirrorContentKey(teamEntry.content, teamEntry.workspaceId))
}

/**
 * True when `teamEntry` is a mirror of one of the personal entries.
 * Accepts a prebuilt index or the raw personal entries.
 */
export function isTeamMirrorOf(
    teamEntry: MirrorCandidate,
    personal: PersonalMirrorIndex | readonly MirrorCandidate[]
): boolean {
    const index = isMirrorIndex(personal) ? personal : buildPersonalMirrorIndex(personal)
    return findMirroredPersonalId(teamEntry, index) !== undefined
}

function isMirrorIndex(
    value: PersonalMirrorIndex | readonly MirrorCandidate[]
): value is PersonalMirrorIndex {
    return !Array.isArray(value)
}

/** Read an entry-like record as a MirrorCandidate (undefined when id/content are missing). */
export function toMirrorCandidate(entry: Readonly<Record<string, unknown>>): MirrorCandidate | undefined {
    const id = entry['id']
    const content = entry['content']
    if (typeof id !== 'number' || typeof content !== 'string') return undefined
    const timestamp = entry['timestamp']
    const workspaceId = entry['workspaceId']
    const origin = entry['originPersonalId']
    return {
        id,
        content,
        ...(typeof timestamp === 'string' ? { timestamp } : {}),
        ...(typeof workspaceId === 'string' ? { workspaceId } : {}),
        ...(typeof origin === 'number' ? { originPersonalId: origin } : {}),
    }
}

/**
 * Collapse team mirrors of personal entries in a merged list (order preserved).
 * Personal hits gain `alsoInTeam: <teamId>`; the mirrored team hits are dropped.
 * Rows from cross-team databases (`team_db` set) are left untouched.
 */
export function collapseTeamMirrors<
    T extends Readonly<Record<string, unknown>> & {
        source?: 'personal' | 'team' | undefined
        team_db?: string | undefined
    },
>(entries: readonly T[]): T[] {
    const personalCandidates: MirrorCandidate[] = []
    for (const entry of entries) {
        if (entry.source !== 'personal') continue
        const candidate = toMirrorCandidate(entry)
        if (candidate !== undefined) personalCandidates.push(candidate)
    }
    if (personalCandidates.length === 0) return [...entries]
    const index = buildPersonalMirrorIndex(personalCandidates)

    const mirroredBy = new Map<number, number>()
    const dropped = new Set<T>()
    for (const entry of entries) {
        if (entry.source !== 'team' || entry.team_db !== undefined) continue
        const candidate = toMirrorCandidate(entry)
        if (candidate === undefined) continue
        const personalId = findMirroredPersonalId(candidate, index)
        if (personalId === undefined || mirroredBy.has(personalId)) continue
        mirroredBy.set(personalId, candidate.id)
        dropped.add(entry)
    }
    if (dropped.size === 0) return [...entries]

    const result: T[] = []
    for (const entry of entries) {
        if (dropped.has(entry)) continue
        if (entry.source === 'personal') {
            const id = entry['id']
            const teamId = typeof id === 'number' ? mirroredBy.get(id) : undefined
            if (teamId !== undefined) {
                result.push({ ...entry, alsoInTeam: teamId })
                continue
            }
        }
        result.push(entry)
    }
    return result
}
