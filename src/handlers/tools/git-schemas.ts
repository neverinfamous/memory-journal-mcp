import { z } from 'zod'
import { ErrorFieldsMixin } from './error-fields-mixin.js'
import { relaxedNumber } from './schemas.js'

export const GitHistoryOptionsSchema = z.object({
    ref: z.string().optional(), path: z.string().optional(), maxCount: z.number().optional(),
    since: z.string().optional(), sortBy: z.enum(['date', 'impact']).optional(),
    scope: z.string().optional(), techDebtAudit: z.boolean().optional(),
    repo: z.string().optional(), workspace_id: z.string().optional(), workspaceId: z.string().optional(),
    project_number: z.number().optional(), cwd: z.string().optional(),
})

export const GitHistoryOptionsSchemaMcp = z.object({
    ref: z.string().optional().describe('Git reference (branch, tag, commit). Default: HEAD'),
    path: z.string().optional().describe('Filter by specific file or directory path'),
    maxCount: relaxedNumber().optional().describe('Maximum number of commits to return. Default: 50'),
    max_count: relaxedNumber().optional(), limit: relaxedNumber().optional(),
    repo: z.string().optional().describe('Target repository or workspace name'),
    workspace_id: z.string().optional(), workspaceId: z.string().optional(),
    project_number: relaxedNumber().optional(), cwd: z.string().optional(),
    since: z.string().optional().describe('Show commits more recent than a specific date'),
    sortBy: z.string().optional().describe('Sort commits by date or impact score'),
    scope: z.string().optional().describe('Filter commits by a specific scope'),
    techDebtAudit: z.boolean().optional().describe('Filter for high impact commits with low trust or missing validation'),
}).transform((d) => ({ ...d, maxCount: d.maxCount ?? d.max_count ?? d.limit }))

export const GitSearchOptionsSchema = z.object({
    query: z.string().min(1), maxCount: z.number().optional(),
    sortBy: z.enum(['date', 'impact']).optional(), scope: z.string().optional(),
    techDebtAudit: z.boolean().optional(), repo: z.string().optional(),
    workspace_id: z.string().optional(), workspaceId: z.string().optional(),
    project_number: z.number().optional(), cwd: z.string().optional(),
})

export const GitSearchOptionsSchemaMcp = z.object({
    query: z.string().optional().describe('Search query to match in commit messages'),
    maxCount: relaxedNumber().optional().describe('Maximum number of commits to return. Default: 50'),
    max_count: relaxedNumber().optional(), limit: relaxedNumber().optional(),
    repo: z.string().optional().describe('Target repository or workspace name'),
    workspace_id: z.string().optional(), workspaceId: z.string().optional(),
    project_number: relaxedNumber().optional(), cwd: z.string().optional(),
    sortBy: z.string().optional().describe('Sort commits by date or impact score'),
    scope: z.string().optional().describe('Filter commits by a specific scope'),
    techDebtAudit: z.boolean().optional().describe('Filter for high impact commits with low trust or missing validation'),
}).transform((d) => ({ ...d, maxCount: d.maxCount ?? d.max_count ?? d.limit }))

export const GitReleaseInfoOptionsSchema = z.object({
    ref: z.string().optional(), repo: z.string().optional(), workspace_id: z.string().optional(),
    workspaceId: z.string().optional(), project_number: relaxedNumber().optional(), cwd: z.string().optional(),
})

export const GitReleaseInfoOptionsSchemaMcp = z.object({
    ref: z.string().optional().describe('Git reference (branch, tag, commit). Default: HEAD'),
    repo: z.string().optional().describe('Target repository or workspace name'),
    workspace_id: z.string().optional(), workspaceId: z.string().optional(),
    project_number: relaxedNumber().optional(), cwd: z.string().optional(),
})

export const GitUnreleasedOptionsSchema = z.object({
    repo: z.string().optional(), workspace_id: z.string().optional(),
    workspaceId: z.string().optional(), project_number: relaxedNumber().optional(), cwd: z.string().optional(),
})

export const GitAnalyzePatternsOptionsSchema = z.object({
    maxCount: relaxedNumber().optional().default(50), repo: z.string().optional(),
    workspace_id: z.string().optional(), workspaceId: z.string().optional(),
    project_number: relaxedNumber().optional(), cwd: z.string().optional(),
})

export const GitOutputSchema = z.object({
    success: z.boolean(),
    commits: z.array(z.unknown()).optional(),
    changelog: z.unknown().optional(),
    error: z.string().optional(),
}).extend(ErrorFieldsMixin.shape)
