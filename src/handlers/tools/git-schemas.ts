import { z } from 'zod'
import { ErrorFieldsMixin } from './error-fields-mixin.js'
import { relaxedNumber, StrictProjectNumberSchema } from './schemas.js'

export const GitHistoryOptionsSchema = z.object({
    ref: z.string().optional(), path: z.string().optional(), maxCount: z.number().optional(),
    since: z.string().optional(), sortBy: z.enum(['date', 'impact']).optional(),
    scope: z.string().optional(), techDebtAudit: z.boolean().optional(),
    repo: z.string().optional(), repo_name: z.string().optional(),
    workspace_id: z.string().optional(), workspaceId: z.string().optional(),
    project_number: StrictProjectNumberSchema.optional(), cwd: z.string().optional(),
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
}).transform((d) => ({
    ...d,
    maxCount: d.maxCount ?? d.max_count ?? d.limit,
    sortBy: d.sortBy ?? d.sort_by,
    techDebtAudit: d.techDebtAudit ?? d.tech_debt_audit,
}))

export const GitSearchOptionsSchema = z.object({
    query: z.string().min(1), maxCount: z.number().optional(),
    sortBy: z.enum(['date', 'impact']).optional(), scope: z.string().optional(),
    techDebtAudit: z.boolean().optional(), repo: z.string().optional(), repo_name: z.string().optional(),
    workspace_id: z.string().optional(), workspaceId: z.string().optional(),
    project_number: StrictProjectNumberSchema.optional(), cwd: z.string().optional(),
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
}).transform((d) => ({
    ...d,
    maxCount: d.maxCount ?? d.max_count ?? d.limit,
    sortBy: d.sortBy ?? d.sort_by,
    techDebtAudit: d.techDebtAudit ?? d.tech_debt_audit,
}))

export const GitReleaseInfoOptionsSchema = z.object({
    ref: z.string().optional(), repo: z.string().optional(), repo_name: z.string().optional(),
    workspace_id: z.string().optional(), workspaceId: z.string().optional(),
    project_number: StrictProjectNumberSchema.optional(), cwd: z.string().optional(),
})

export const GitReleaseInfoOptionsSchemaMcp = z.object({
    ref: z.string().optional().describe('Git reference (branch, tag, commit). Default: HEAD'),
    repo: z.string().optional().describe('Target repository or workspace name'),
    repo_name: z.string().optional().describe('Alias for repo'),
    workspace_id: z.string().optional().describe('Target workspace identifier'),
    workspaceId: z.string().optional().describe('Alias for workspace_id'),
    project_number: relaxedNumber().optional().describe('Target GitHub project number'),
    cwd: z.string().optional().describe('Working directory path for git operations'),
})

export const GitUnreleasedOptionsSchema = z.object({
    repo: z.string().optional().describe('Target repository or workspace name'),
    repo_name: z.string().optional().describe('Alias for repo'),
    workspace_id: z.string().optional().describe('Target workspace identifier'),
    workspaceId: z.string().optional().describe('Alias for workspace_id'),
    project_number: relaxedNumber().optional().describe('Target GitHub project number'),
    cwd: z.string().optional().describe('Working directory path for git operations'),
})

export const GitAnalyzePatternsOptionsSchema = z.object({
    maxCount: relaxedNumber().optional().describe('Maximum number of commits to analyze. Default: 50'),
    max_count: relaxedNumber().optional().describe('Alias for maxCount'),
    repo: z.string().optional().describe('Target repository or workspace name'),
    repo_name: z.string().optional().describe('Alias for repo'),
    workspace_id: z.string().optional().describe('Target workspace identifier'),
    workspaceId: z.string().optional().describe('Alias for workspace_id'),
    project_number: relaxedNumber().optional().describe('Target GitHub project number'),
    cwd: z.string().optional().describe('Working directory path for git operations'),
}).transform((d) => ({
    ...d,
    maxCount: d.maxCount ?? d.max_count ?? 50,
}))

export const GitOutputSchema = z.object({
    success: z.boolean(),
    commits: z.array(z.unknown()).optional(),
    changelog: z.unknown().optional(),
    error: z.string().optional(),
}).extend(ErrorFieldsMixin.shape)
