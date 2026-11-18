import { z } from 'zod'
import { ErrorFieldsMixin } from './error-fields-mixin.js'
import { relaxedNumber, StrictProjectNumberSchema } from './schemas.js'
import { parsePositiveProjectNumber } from '../../utils/safe-positive-int.js'

function coerceRelaxed(v: number | string | undefined): number | undefined {
    if (v === undefined || typeof v === 'number') return v
    return v.trim() === '' ? undefined : Number(v)
}

function coerceCanonicalProject(v: number | string | undefined): number | undefined {
    if (v === undefined || (typeof v === 'string' && v.trim() === '')) return undefined
    const parsed = parsePositiveProjectNumber(v)
    if (parsed === undefined) {
        throw new Error(`Invalid project_number '${String(v)}'. Expected a canonical positive integer.`)
    }
    return parsed
}

export const GitHistoryOptionsSchema = z.object({
    ref: z.string().optional(),
    path: z.string().optional(),
    maxCount: z.number().int().positive().max(10000).optional(),
    since: z.string().optional(),
    sortBy: z.enum(['date', 'impact']).optional(),
    scope: z.string().optional(),
    techDebtAudit: z.boolean().optional(),
    summary: z.boolean().optional(),
    repo: z.string().optional(),
    repo_name: z.string().optional(),
    workspace_id: z.string().optional(),
    workspaceId: z.string().optional(),
    project_number: StrictProjectNumberSchema.optional(),
    cwd: z.string().optional(),
})

export const GitHistoryOptionsSchemaMcp = z.object({
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
}).transform((d) => ({
    ...d,
    maxCount: coerceRelaxed(d.maxCount ?? d.max_count ?? d.limit),
    project_number: coerceCanonicalProject(d.project_number),
    sortBy: d.sortBy ?? d.sort_by,
    techDebtAudit: d.techDebtAudit ?? d.tech_debt_audit,
}))

export const GitSearchOptionsSchema = z.object({
    query: z.string().min(1),
    maxCount: z.number().int().positive().max(10000).optional(),
    sortBy: z.enum(['date', 'impact']).optional(),
    scope: z.string().optional(),
    techDebtAudit: z.boolean().optional(),
    summary: z.boolean().optional(),
    repo: z.string().optional(),
    repo_name: z.string().optional(),
    workspace_id: z.string().optional(),
    workspaceId: z.string().optional(),
    project_number: StrictProjectNumberSchema.optional(),
    cwd: z.string().optional(),
})

export const GitSearchOptionsSchemaMcp = z.object({
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
}).transform((d) => ({
    ...d,
    maxCount: coerceRelaxed(d.maxCount ?? d.max_count ?? d.limit),
    project_number: coerceCanonicalProject(d.project_number),
    sortBy: d.sortBy ?? d.sort_by,
    techDebtAudit: d.techDebtAudit ?? d.tech_debt_audit,
}))

export const GitReleaseInfoOptionsSchema = z.object({
    ref: z.string().optional(), repo: z.string().optional(), repo_name: z.string().optional(),
    workspace_id: z.string().optional(), workspaceId: z.string().optional(),
    project_number: StrictProjectNumberSchema.optional(), cwd: z.string().optional(),
})

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
        workspace_id: z.string().optional().describe('Target workspace identifier'),
        workspaceId: z.string().optional().describe('Alias for workspace_id'),
        project_number: relaxedNumber().optional().describe('Target GitHub project number'),
        cwd: z.string().optional().describe('Working directory path for git operations'),
    })
    .transform((d) => {
        const rawMax = coerceRelaxed(d.maxCount ?? d.max_count ?? d.limit)
        const parsedMax =
            rawMax !== undefined
                ? z.number().int().positive().max(5000).parse(rawMax)
                : undefined
        return {
            ...d,
            maxCount: parsedMax,
            project_number: coerceCanonicalProject(d.project_number),
        }
    })

export const GitAnalyzePatternsOptionsSchema = z.object({
    maxCount: relaxedNumber().optional().describe('Maximum number of commits to analyze. Default: 50'),
    max_count: relaxedNumber().optional().describe('Alias for maxCount'),
    limit: relaxedNumber().optional().describe('Alias for maxCount'),
    repo: z.string().optional().describe('Target repository or workspace name'),
    repo_name: z.string().optional().describe('Alias for repo'),
    workspace_id: z.string().optional().describe('Target workspace identifier'),
    workspaceId: z.string().optional().describe('Alias for workspace_id'),
    project_number: relaxedNumber().optional().describe('Target GitHub project number'),
    cwd: z.string().optional().describe('Working directory path for git operations'),
}).transform((d) => ({
    ...d,
    maxCount: coerceRelaxed(d.maxCount ?? d.max_count ?? d.limit) ?? 50,
    project_number: coerceCanonicalProject(d.project_number),
}))

export const GitOutputSchema = z.object({
    success: z.boolean().optional(),
    commits: z.array(z.unknown()).optional(),
    changelog: z.unknown().optional(),
    error: z.string().optional(),
}).extend(ErrorFieldsMixin.shape)
