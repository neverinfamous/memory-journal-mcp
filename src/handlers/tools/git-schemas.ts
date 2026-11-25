import { z } from 'zod'
import { ErrorFieldsMixin } from './error-fields-mixin.js'
import { relaxedNumber, StrictProjectNumberSchema } from './schemas.js'
import { parseCanonicalPositiveInt, parsePositiveProjectNumber } from '../../utils/safe-positive-int.js'

function coerceRelaxed(v: number | string | undefined): number | undefined {
    if (v === undefined) return undefined
    if (typeof v === 'number') {
        return Number.isSafeInteger(v) && v > 0 ? v : Number.NaN
    }
    const trimmed = v.trim()
    if (trimmed === '') return Number.NaN
    return parseCanonicalPositiveInt(trimmed) ?? Number.NaN
}

function coerceCanonicalProject(v: number | string | undefined): number | undefined {
    if (v === undefined) return undefined
    if (typeof v === 'string' && v.trim() === '') return Number.NaN
    return parsePositiveProjectNumber(v) ?? Number.NaN
}

export const GitHistoryOptionsSchema = z.object({
    ref: z.string().max(255).optional(),
    path: z.string().max(500).optional(),
    maxCount: z.number().int().positive().max(10000).optional(),
    since: z.string().max(64).optional(),
    sortBy: z.enum(['date', 'impact']).optional(),
    scope: z.string().max(255).optional(),
    techDebtAudit: z.boolean().optional(),
    summary: z.boolean().optional(),
    uncommitted: z.boolean().optional(),
    repo: z.string().max(255).optional(),
    repo_name: z.string().max(255).optional(),
    workspace_id: z.string().max(255).optional(),
    workspaceId: z.string().max(255).optional(),
    project_number: StrictProjectNumberSchema.optional(),
    cwd: z.string().max(500).optional(),
}).strict()

function checkMaxCountConflicts(
    d: { maxCount?: number | string | undefined; max_count?: number | string | undefined; limit?: number | string | undefined },
    ctx: z.RefinementCtx
): void {
    const defined = [d.maxCount, d.max_count, d.limit]
        .filter((v): v is number | string => v !== undefined)
        .map((v) => coerceRelaxed(v))
    if (defined.length > 1 && defined.some((v) => !Object.is(v, defined[0]))) {
        ctx.addIssue({
            code: 'custom',
            path: ['maxCount'],
            message: "Conflicting values provided for 'maxCount', 'max_count', or 'limit'.",
        })
    }
}

function checkHistoryAndSearchConflicts(
    d: {
        maxCount?: number | string | undefined
        max_count?: number | string | undefined
        limit?: number | string | undefined
        sortBy?: string | undefined
        sort_by?: string | undefined
        techDebtAudit?: boolean | undefined
        tech_debt_audit?: boolean | undefined
    },
    ctx: z.RefinementCtx
): void {
    checkMaxCountConflicts(d, ctx)
    if (d.sortBy !== undefined && d.sort_by !== undefined && d.sortBy !== d.sort_by) {
        ctx.addIssue({
            code: 'custom',
            path: ['sortBy'],
            message: "Conflicting values provided for 'sortBy' and 'sort_by'.",
        })
    }
    if (
        d.techDebtAudit !== undefined &&
        d.tech_debt_audit !== undefined &&
        d.techDebtAudit !== d.tech_debt_audit
    ) {
        ctx.addIssue({
            code: 'custom',
            path: ['techDebtAudit'],
            message: "Conflicting values provided for 'techDebtAudit' and 'tech_debt_audit'.",
        })
    }
}

export const GitHistoryOptionsSchemaMcp = z
    .object({
        ref: z.string().optional().describe('Git reference (branch, tag, commit). Default: HEAD'),
        path: z.string().optional().describe('Filter by specific file or directory path'),
        maxCount: relaxedNumber().optional().describe('Maximum number of commits to return. Default: 50'),
        max_count: relaxedNumber().optional().describe('Alias for maxCount'),
        limit: relaxedNumber().optional().describe('Alias for maxCount'),
        repo: z.string().optional().describe('Target repository or workspace name'),
        repo_name: z.string().optional().describe('Alias for repo'),
        workspace_id: z.string().optional().describe('Target workspace identifier'),
        workspaceId: z.string().optional().describe('Alias for workspace_id'),
        project_number: relaxedNumber().optional().describe('Target GitHub project number'),
        cwd: z.string().optional().describe('Working directory path for git operations'),
        since: z.string().optional().describe('Show commits more recent than a specific date'),
        sortBy: z.string().optional().describe('Sort commits by date or impact score'),
        sort_by: z.string().optional().describe('Alias for sortBy'),
        scope: z.string().optional().describe('Filter commits by a specific scope'),
        techDebtAudit: z.boolean().optional().describe('Filter for high impact commits with low trust or missing validation'),
        tech_debt_audit: z.boolean().optional().describe('Alias for techDebtAudit'),
        summary: z.boolean().optional().describe('Skip per-file diffstat computation for fast commit metadata queries'),
        uncommitted: z.boolean().optional().describe('Include uncommitted working-tree status and diffstat (staged, unstaged, untracked) in uncommitted field'),
    })
    .strict()
    .superRefine(checkHistoryAndSearchConflicts)
    .transform(({ max_count, limit, sort_by, tech_debt_audit, ...rest }) => {
        const resolvedMaxCount = coerceRelaxed(rest.maxCount ?? max_count ?? limit)
        const resolvedProject = coerceCanonicalProject(rest.project_number)
        const resolvedSortBy = rest.sortBy ?? sort_by
        const resolvedTechAudit = rest.techDebtAudit ?? tech_debt_audit
        return {
            ...rest,
            ...(resolvedMaxCount !== undefined ? { maxCount: resolvedMaxCount } : {}),
            ...(resolvedProject !== undefined ? { project_number: resolvedProject } : {}),
            ...(resolvedSortBy !== undefined ? { sortBy: resolvedSortBy } : {}),
            ...(resolvedTechAudit !== undefined ? { techDebtAudit: resolvedTechAudit } : {}),
        }
    })

export const GitSearchOptionsSchema = z.object({
    query: z.string().min(1).max(500),
    maxCount: z.number().int().positive().max(10000).optional(),
    sortBy: z.enum(['date', 'impact']).optional(),
    scope: z.string().max(255).optional(),
    techDebtAudit: z.boolean().optional(),
    summary: z.boolean().optional(),
    repo: z.string().max(255).optional(),
    repo_name: z.string().max(255).optional(),
    workspace_id: z.string().max(255).optional(),
    workspaceId: z.string().max(255).optional(),
    project_number: StrictProjectNumberSchema.optional(),
    cwd: z.string().max(500).optional(),
}).strict()

export const GitSearchOptionsSchemaMcp = z
    .object({
        query: z.string().optional().describe('Search query to match in commit messages'),
        maxCount: relaxedNumber().optional().describe('Maximum number of commits to return. Default: 50'),
        max_count: relaxedNumber().optional().describe('Alias for maxCount'),
        limit: relaxedNumber().optional().describe('Alias for maxCount'),
        repo: z.string().optional().describe('Target repository or workspace name'),
        repo_name: z.string().optional().describe('Alias for repo'),
        workspace_id: z.string().optional().describe('Target workspace identifier'),
        workspaceId: z.string().optional().describe('Alias for workspace_id'),
        project_number: relaxedNumber().optional().describe('Target GitHub project number'),
        cwd: z.string().optional().describe('Working directory path for git operations'),
        sortBy: z.string().optional().describe('Sort commits by date or impact score'),
        sort_by: z.string().optional().describe('Alias for sortBy'),
        scope: z.string().optional().describe('Filter commits by a specific scope'),
        techDebtAudit: z.boolean().optional().describe('Filter for high impact commits with low trust or missing validation'),
        tech_debt_audit: z.boolean().optional().describe('Alias for techDebtAudit'),
        summary: z.boolean().optional().describe('Skip per-file diffstat computation for fast commit search queries'),
    })
    .strict()
    .superRefine(checkHistoryAndSearchConflicts)
    .transform(({ max_count, limit, sort_by, tech_debt_audit, ...rest }) => {
        const resolvedMaxCount = coerceRelaxed(rest.maxCount ?? max_count ?? limit)
        const resolvedProject = coerceCanonicalProject(rest.project_number)
        const resolvedSortBy = rest.sortBy ?? sort_by
        const resolvedTechAudit = rest.techDebtAudit ?? tech_debt_audit
        return {
            ...rest,
            ...(resolvedMaxCount !== undefined ? { maxCount: resolvedMaxCount } : {}),
            ...(resolvedProject !== undefined ? { project_number: resolvedProject } : {}),
            ...(resolvedSortBy !== undefined ? { sortBy: resolvedSortBy } : {}),
            ...(resolvedTechAudit !== undefined ? { techDebtAudit: resolvedTechAudit } : {}),
        }
    })

export const GitReleaseInfoOptionsSchema = z
    .object({
        ref: z.string().max(255).optional(),
        repo: z.string().max(255).optional(),
        repo_name: z.string().max(255).optional(),
        workspace_id: z.string().max(255).optional(),
        workspaceId: z.string().max(255).optional(),
        project_number: StrictProjectNumberSchema.optional(),
        cwd: z.string().max(500).optional(),
    })
    .strict()

export const GitReleaseInfoOptionsSchemaMcp = z
    .object({
        ref: z.string().optional().describe('Git reference (branch, tag, commit). Default: HEAD'),
        repo: z.string().optional().describe('Target repository or workspace name'),
        repo_name: z.string().optional().describe('Alias for repo'),
        workspace_id: z.string().optional().describe('Target workspace identifier'),
        workspaceId: z.string().optional().describe('Alias for workspace_id'),
        project_number: relaxedNumber().optional().describe('Target GitHub project number'),
        cwd: z.string().optional().describe('Working directory path for git operations'),
    })
    .strict()
    .transform((d) => ({
        ...d,
        project_number: coerceCanonicalProject(d.project_number),
    }))

export const GitUnreleasedOptionsSchema = z
    .object({
        maxCount: relaxedNumber()
            .optional()
            .describe('Maximum number of unreleased commits to return (default: 100, max: 5000)'),
        max_count: relaxedNumber().optional().describe('Alias for maxCount'),
        limit: relaxedNumber().optional().describe('Alias for maxCount'),
        summary: z
            .boolean()
            .optional()
            .describe('Skip per-file diffstat computation for fast changelog retrieval'),
        repo: z.string().optional().describe('Target repository or workspace name'),
        repo_name: z.string().optional().describe('Alias for repo'),
        workspace_id: z.string().max(255).optional().describe('Target workspace identifier'),
        workspaceId: z.string().max(255).optional().describe('Alias for workspace_id'),
        project_number: relaxedNumber().optional().describe('Target GitHub project number'),
        cwd: z.string().optional().describe('Working directory path for git operations'),
    })
    .strict()
    .superRefine(checkMaxCountConflicts)
    .transform(({ max_count, limit, ...d }) => ({
        ...d,
        maxCount: coerceRelaxed(d.maxCount ?? max_count ?? limit),
        project_number: coerceCanonicalProject(d.project_number),
    }))

export const GitAnalyzePatternsOptionsSchema = z
    .object({
        maxCount: relaxedNumber().optional().describe('Maximum number of commits to analyze. Default: 50'),
        max_count: relaxedNumber().optional().describe('Alias for maxCount'),
        limit: relaxedNumber().optional().describe('Alias for maxCount'),
        repo: z.string().optional().describe('Target repository or workspace name'),
        repo_name: z.string().optional().describe('Alias for repo'),
        workspace_id: z.string().max(255).optional().describe('Target workspace identifier'),
        workspaceId: z.string().max(255).optional().describe('Alias for workspace_id'),
        project_number: relaxedNumber().optional().describe('Target GitHub project number'),
        cwd: z.string().optional().describe('Working directory path for git operations'),
    })
    .strict()
    .superRefine(checkMaxCountConflicts)
    .transform(({ max_count, limit, ...d }) => ({
        ...d,
        maxCount: coerceRelaxed(d.maxCount ?? max_count ?? limit) ?? 50,
        project_number: coerceCanonicalProject(d.project_number),
    }))

export const GitOutputSchema = z.object({
    success: z.boolean().optional(),
    commits: z.array(z.unknown()).optional(),
    changelog: z.unknown().optional(),
    uncommitted: z.unknown().optional(),
    error: z.string().optional(),
}).extend(ErrorFieldsMixin.shape)
