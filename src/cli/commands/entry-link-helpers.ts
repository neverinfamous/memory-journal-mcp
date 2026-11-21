import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { JournalEntry, RelationshipType } from '../../types/index.js'
import {
    computeSuggestedLinks,
    previewDraftSuggestedLinks,
} from '../../handlers/tools/core/link-suggestions.js'

export function handleCliDryRunLinks(params: {
    db: IDatabaseAdapter
    workspaceId: string
    projectNumber: number | undefined
    sessionId: string | undefined
    anchors: readonly { anchorPath: string }[] | undefined
    json: boolean | undefined
}): void {
    const suggested = previewDraftSuggestedLinks({
        db: params.db,
        workspaceId: params.workspaceId,
        projectNumber: params.projectNumber,
        sessionId: params.sessionId,
        anchors: params.anchors?.map((a) => ({ anchor_path: a.anchorPath })),
    })
    if (params.json === true) {
        process.stdout.write(
            JSON.stringify({ status: 'dry-run', suggested_links: suggested }) + '\n'
        )
    } else {
        process.stderr.write(
            `Dry-run suggested links (${String(suggested.length)}): ${suggested.map((s) => `#${String(s.targetId)} (${s.relationType}, ${s.reason})`).join(', ') || 'none'}\n`
        )
    }
}

export async function autoPopulateCliSuggestedLinks(params: {
    db: IDatabaseAdapter
    entry: JournalEntry
    workspaceId: string
    projectNumber: number | undefined
    sessionId: string | undefined
    relationships: { target_id: number; relation_type: RelationshipType }[]
    relatedIds: number[]
    autoLink: boolean | undefined
    isTeam: boolean | undefined
}): Promise<void> {
    if (
        params.relationships.length > 0 ||
        params.relatedIds.length > 0 ||
        params.autoLink !== true ||
        params.isTeam === true
    ) {
        return
    }
    const autoTargets = (
        await computeSuggestedLinks({
            db: params.db,
            entry: params.entry,
            workspaceId: params.workspaceId,
            projectNumber: params.projectNumber,
            sessionId: params.sessionId,
            limit: 2,
        })
    ).filter((s) => s.reason === 'same-session' || s.reason === 'shared-anchor')
    for (const target of autoTargets) {
        params.relationships.push({
            target_id: target.targetId,
            relation_type: target.relationType,
        })
    }
}
