import { z } from 'zod'
import { execFileSync } from 'node:child_process'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import { relaxedNumber } from '../schemas.js'
import { coerceAnchorStatusAlias } from '../schemas/hallucination-healer-fields.js'
import { mcpLogger } from '../../../utils/mcp-logger.js'
import {
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
} from '../../../utils/workspace-resolver.js'
import { resolveWriteWorkspaceId } from '../write-workspace.js'

const MAX_AUTO_ANCHORS = 25
const SHA_REGEX = /^[0-9a-f]{7,40}$/i

type AnchorStatus = 'pending' | 'valid' | 'stale' | 'invalidated' | 'unresolvable'

/**
 * Resolves explicit anchors or auto-extracts modified file paths from `auto_context.commits`
 * so `checkEntryStaleness` has populated `entry_anchors` rows automatically.
 */
export function resolveEntryAnchors(
    explicitAnchors:
        | { anchor_path: string; anchor_type: string; status?: AnchorStatus }[]
        | undefined,
    autoContext: string | undefined,
    workspaceId: string,
    context: ToolContext
): { anchorPath: string; anchorType: string; status?: AnchorStatus }[] | undefined {
    if (explicitAnchors !== undefined && explicitAnchors.length > 0) {
        return explicitAnchors.map((a) => ({
            anchorPath: a.anchor_path,
            anchorType: a.anchor_type,
            ...(a.status !== undefined ? { status: a.status } : {}),
        }))
    }
    if (autoContext === undefined || autoContext === '') {
        return undefined
    }
    try {
        const parsed: unknown = JSON.parse(autoContext)
        if (parsed === null || typeof parsed !== 'object') return undefined
        const commitsVal = 'commits' in parsed ? parsed.commits : undefined
        if (!Array.isArray(commitsVal) || commitsVal.length === 0) return undefined

        const validShas = commitsVal
            .filter((s): s is string => typeof s === 'string' && SHA_REGEX.test(s.trim()))
            .map((s) => s.trim())
            .slice(0, 10)
        if (validShas.length === 0) return undefined

        const registry = context.config?.projectRegistry ?? loadProjectRegistryFromConfig()
        const canonicalKey = findCanonicalRegistryKey(workspaceId, registry) ?? workspaceId
        const repoPath = registry !== undefined ? registry[canonicalKey]?.path : undefined
        if (repoPath === undefined || repoPath.length === 0) return undefined

        const output = execFileSync(
            'git',
            ['show', '--name-only', '--pretty=format:', ...validShas],
            {
                cwd: repoPath,
                encoding: 'utf-8',
                timeout: 2500,
                stdio: ['ignore', 'pipe', 'ignore'],
            }
        )
        const uniqueFiles = Array.from(
            new Set(
                output
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0)
            )
        ).slice(0, MAX_AUTO_ANCHORS)

        if (uniqueFiles.length === 0) return undefined
        return uniqueFiles.map((anchorPath) => ({ anchorPath, anchorType: 'file' }))
    } catch (err) {
        mcpLogger.warning('git', 'Auto-anchor extraction failed', {
            error: err instanceof Error ? err.message : String(err),
        })
        return undefined
    }
}

function preprocessMarkAnchorsStale(val: unknown): unknown {
    if (typeof val !== 'object' || val === null || Array.isArray(val)) return val
    const obj = { ...(val as Record<string, unknown>) }
    if (obj['updates'] === undefined && Array.isArray(obj['anchors'])) {
        obj['updates'] = obj['anchors']
        delete obj['anchors']
    }
    if (Array.isArray(obj['updates'])) {
        obj['updates'] = obj['updates'].map((rawItem: unknown) => {
            if (typeof rawItem !== 'object' || rawItem === null || Array.isArray(rawItem)) {
                return rawItem
            }
            const item = { ...(rawItem as Record<string, unknown>) }
            // [INVARIANT] M2: only anchor-ID aliases map to entry_anchors.id. entry_id/entryId are
            // journal entry IDs and are left unmapped so the schema rejects them (missing `id`).
            const rawId = item['id'] ?? item['anchor_id'] ?? item['anchorId']
            if (rawId !== undefined) {
                const numId = typeof rawId === 'string' ? Number(rawId.trim()) : rawId
                if (typeof numId === 'number' && !Number.isNaN(numId)) {
                    item['id'] = numId
                }
            }
            delete item['anchor_id']
            delete item['anchorId']
            const mappedStatus = coerceAnchorStatusAlias(item['status'])
            if (mappedStatus !== undefined) {
                item['status'] = mappedStatus
            }
            return item
        })
    }
    return obj
}

export const MarkAnchorsStaleSchema = z.preprocess(
    preprocessMarkAnchorsStale,
    z.object({
        updates: z.array(
            z.object({
                id: z.number(),
                status: z.enum(['pending', 'valid', 'stale', 'invalidated', 'unresolvable']),
            })
        ),
        workspace_id: z.string().optional(),
        project_number: z.number().optional(),
    })
)

export const MarkAnchorsStaleSchemaMcp = z.preprocess(
    preprocessMarkAnchorsStale,
    z.object({
        updates: z
            .array(
                z.object({
                    id: relaxedNumber(),
                    status: z.string(),
                })
            )
            .optional(),
        workspace_id: z.string().optional(),
        project_number: relaxedNumber().optional(),
    })
)

export function getStalenessTools(context: ToolContext): ToolDefinition[] {
    const { db } = context

    return [
        {
            name: 'mark_anchors_stale',
            title: 'Mark Anchors Stale',
            description:
                'Update the status of multiple anchors (e.g. to stale or invalidated) based on validation rules or git history checks.',
            group: 'core',
            inputSchema: MarkAnchorsStaleSchemaMcp,
            outputSchema: z
                .object({
                    success: z.boolean(),
                    updated_count: z.number(),
                    not_found_ids: z.array(z.number()).optional(),
                })
                .extend(ErrorFieldsMixin.shape),
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const input = MarkAnchorsStaleSchema.parse(params)
                    const wsId = resolveWriteWorkspaceId(
                        input.workspace_id,
                        input.project_number,
                        context.config
                    )

                    let updatedCount = 0
                    const missingIds: number[] = []
                    db.executeInTransaction(() => {
                        for (const update of input.updates) {
                            if (db.updateAnchorStatus(update.id, update.status, wsId)) {
                                updatedCount++
                            } else {
                                missingIds.push(update.id)
                            }
                        }
                    })

                    if (updatedCount === 0) {
                        return {
                            success: false,
                            error: 'No anchors were updated',
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            recoverable: true,
                            updated_count: 0,
                            ...(missingIds.length > 0 ? { not_found_ids: missingIds } : {}),
                        }
                    }
                    return {
                        success: true,
                        updated_count: updatedCount,
                        ...(missingIds.length > 0 ? { not_found_ids: missingIds } : {}),
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        }
    ]
}
