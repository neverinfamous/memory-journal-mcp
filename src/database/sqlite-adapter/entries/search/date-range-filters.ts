import type { EntryType } from '../../../../types/index.js'
import { ValidationError } from '../../../../types/errors.js'
import { decodeCursor } from './cursor.js'
import { chunkedInPredicate } from '../../row-helpers.js'
import { expandTagFilterValues } from '../../tags.js'
import {
    excludesCommitNarrative,
    legacyCommitExclusionSql,
} from '../../../../utils/legacy-commit-narrative.js'

/**
 * Decodes a pagination cursor into keyset/offset state for `searchByDateRange`.
 */
export function decodeDateRangeCursor(cursor: string | undefined): {
    offset: number
    hasKeyset: boolean
    keysetT: string
    keysetId: number
} {
    let offset = 0
    let hasKeyset = false
    let keysetT = ''
    let keysetId = 0
    if (cursor !== undefined && cursor !== '') {
        const decoded = decodeCursor(cursor)
        if (decoded === null) {
            throw new ValidationError('Invalid cursor format')
        }
        if ('t' in decoded) {
            hasKeyset = true
            keysetT = decoded.t
            keysetId = decoded.id
        } else if ('offset' in decoded) {
            offset = decoded.offset
        }
    }
    return { offset, hasKeyset, keysetT, keysetId }
}

/**
 * Appends the optional tag/type/attribute filter conditions for `searchByDateRange`.
 */
export function appendDateRangeFilters(
    conditions: string[],
    params: unknown[],
    options:
        | {
              entryType?: EntryType
              tags?: string[]
              excludeTags?: string[]
              isPersonal?: boolean
              projectNumber?: number
              issueNumber?: number
              prNumber?: number
              workflowRunId?: number
          }
        | undefined
): void {
    if (options?.tags !== undefined && options.tags.length > 0) {
        const expandedTags = expandTagFilterValues(options.tags)
        if (expandedTags.length > 0) {
            const membership = chunkedInPredicate(
                expandedTags,
                (placeholders) =>
                    `EXISTS (SELECT 1 FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE et.entry_id = e.id AND LOWER(t.name) IN (${placeholders}))`,
                'OR'
            )
            conditions.push(membership.sql)
            params.push(...membership.params)
        }
    }

    if (options?.excludeTags !== undefined && options.excludeTags.length > 0) {
        const expandedExcluded = expandTagFilterValues(options.excludeTags)
        if (expandedExcluded.length > 0) {
            const membership = chunkedInPredicate(
                expandedExcluded,
                (placeholders) =>
                    `NOT EXISTS (SELECT 1 FROM entry_tags et_ex JOIN tags t_ex ON et_ex.tag_id = t_ex.id WHERE et_ex.entry_id = e.id AND LOWER(t_ex.name) IN (${placeholders}))`,
                'AND'
            )
            conditions.push(membership.sql)
            params.push(...membership.params)
        }
        // [INVARIANT] M1 read-side fallback: untagged legacy session-commits rows are also excluded.
        if (excludesCommitNarrative(expandedExcluded)) {
            conditions.push(legacyCommitExclusionSql('e'))
        }
    }

    if (options?.entryType !== undefined) {
        conditions.push(`e.entry_type = ?`)
        params.push(options.entryType)
    }

    if (options?.isPersonal !== undefined) {
        conditions.push(`e.is_personal = ?`)
        params.push(options.isPersonal ? 1 : 0)
    }

    if (options?.projectNumber !== undefined) {
        conditions.push(`e.project_number = ?`)
        params.push(options.projectNumber)
    }

    if (options?.issueNumber !== undefined) {
        conditions.push(`e.issue_number = ?`)
        params.push(options.issueNumber)
    }

    if (options?.prNumber !== undefined) {
        conditions.push(`e.pr_number = ?`)
        params.push(options.prNumber)
    }

    if (options?.workflowRunId !== undefined) {
        conditions.push(`e.workflow_run_id = ?`)
        params.push(options.workflowRunId)
    }
}
