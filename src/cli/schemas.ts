import { z } from 'zod'

export const safeCoerceNumber = z.preprocess((val) => {
    if (val === undefined || val === null) return undefined
    if (typeof val === 'number') return Number.isFinite(val) ? val : val
    if (typeof val === 'string') {
        const trimmed = val.trim()
        if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) return val
        const parsed = Number(trimmed)
        if (!Number.isFinite(parsed)) return val
        if (!trimmed.includes('.') && !Number.isSafeInteger(parsed)) return val
        return parsed
    }
    return val
}, z.number().optional())

const safeCoerceCanonicalDecimal = (val: unknown): unknown => {
    if (val === undefined || val === null) return undefined
    if (typeof val === 'number') return val
    if (typeof val === 'string') {
        const trimmed = val.trim()
        if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) return val
        const parsed = Number(trimmed)
        if (!Number.isFinite(parsed)) return val
        if (!trimmed.includes('.') && !Number.isSafeInteger(parsed)) return val
        return parsed
    }
    return val
}

export const safeCoercePositiveInt = z.preprocess(
    safeCoerceCanonicalDecimal,
    z.number().int().positive().optional()
)
export const safeCoerceNonNegativeNumber = z.preprocess(
    safeCoerceCanonicalDecimal,
    z.number().min(0).optional()
)
export const safeCoerceUnitInterval = z.preprocess(
    safeCoerceCanonicalDecimal,
    z.number().min(0).max(1).optional()
)

export const safeCoerceValidationStatus = z.preprocess((val) => {
    if (val === undefined || val === null || val === '') return undefined
    if (typeof val === 'boolean') {
        return val ? 'passed' : 'failed'
    }
    if (typeof val === 'string') {
        const lower = val.trim().toLowerCase()
        if (['passed', 'pass', 'success', 'ok', 'validated', 'valid', 'verified', 'true', '1'].includes(lower)) {
            return 'passed'
        }
        if (['failed', 'fail', 'error', 'failing', 'false', '0'].includes(lower)) {
            return 'failed'
        }
        if (['none', 'null', 'undefined', 'skip', 'skipped', 'unknown', 'pending'].includes(lower)) {
            return 'none'
        }
    }
    return 'none'
}, z.enum(['passed', 'failed', 'none']).optional())

export const coreOptionsSchema = z.object({
    config: z.string().optional(),
    dumpConfig: z.boolean().optional(),
    logLevel: z.string().optional(),
    maxToolInputElements: z.string().optional(),
    agentHealing: z.boolean().optional(),
    instructionLevel: z.string().optional()
})

export const databaseOptionsSchema = z.object({
    db: z.string().optional(),
    database: z.string().optional(),
    testDb: z.string().optional(),
    teamDb: z.string().optional(),
    teamDatabase: z.string().optional(),
    testTeamDb: z.string().optional(),
    additionalTeamDbs: z.string().optional(),
    teamDefaultRole: z.string().optional(),
    teamAdmin: z.string().optional()
})

export const safeCoerceDefaultProject = z.preprocess((val) => {
    if (val === undefined || val === null) return undefined
    if (typeof val === 'number') {
        return Number.isSafeInteger(val) && val > 0 ? val : val
    }
    if (typeof val === 'string') {
        const trimmed = val.trim()
        if (!/^p?[1-9]\d*$/i.test(trimmed)) return val
        const digits = trimmed.replace(/^p/i, '')
        const parsed = Number(digits)
        return Number.isSafeInteger(parsed) && String(parsed) === digits ? parsed : val
    }
    return val
}, z.number().int().positive().optional())

export const workspaceOptionsSchema = z.object({
    defaultProject: safeCoerceDefaultProject,
    defaultWorkspaceId: z.string().optional(),
    workspace: z.string().optional()
})

export const vectorOptionsSchema = z.object({
    embeddingModel: z.string().optional(),
    autoRebuildIndex: z.boolean().optional()
})

export const networkOptionsSchema = z.object({
    transport: z.string().optional(),
    http: z.boolean().optional(),
    stdio: z.boolean().optional(),
    port: z.string().optional(),
    serverHost: z.string().optional(),
    stateless: z.boolean().optional(),
    corsOrigin: z.string().optional(),
    enableHsts: z.boolean().optional(),
    authToken: z.string().optional(),
    authScopes: z.string().optional(),
    trustProxy: z.boolean().optional(),
    publicOrigin: z.string().optional()
})

export const oauthOptionsSchema = z.object({
    oauthEnabled: z.boolean().optional(),
    oauthIssuer: z.string().optional(),
    oauthAudience: z.string().optional(),
    oauthJwksUri: z.string().optional(),
    oauthClockTolerance: z.string().optional(),
    oauthAllowPlaintextLoopback: z.boolean().optional()
})

export const auditOptionsSchema = z.object({
    auditLog: z.string().optional(),
    auditRedact: z.boolean().optional(),
    auditReads: z.boolean().optional(),
    auditLogMaxSize: z.string().optional()
})

export const codeModeOptionsSchema = z.object({
    allowedIoRoots: z.string().optional(),
    codemodeInternalFullAccess: z.boolean().optional(),
    codemodeMaxResultSize: z.string().optional(),
    toolFilter: z.string().optional()
})

export const pruningOptionsSchema = z.object({
    archiveOlderThanDays: z.string().optional(),
    pruneOlderThanDays: z.string().optional(),
    hardDeleteOlderThanDays: z.string().optional(),
    pruneImportanceThreshold: z.string().optional(),
    pruneDryRun: z.boolean().optional(),
    pruneExcludeTags: z.string().optional()
})

export const briefingOptionsSchema = z.object({
    briefingImportanceThreshold: z.string().optional(),
    briefingPrCount: z.string().optional(),
    briefingEntries: z.string().optional(),
    briefingCommits: z.string().optional(),
    briefingSummaries: z.string().optional(),
    briefingIncludeTeam: z.boolean().optional(),
    briefingIssues: z.string().optional(),
    briefingPrs: z.string().optional(),
    briefingPrStatus: z.boolean().optional(),
    briefingMilestones: z.string().optional(),
    rulesFile: z.string().optional(),
    skillsDir: z.string().optional(),
    briefingWorkflows: z.string().optional(),
    briefingWorkflowStatus: z.boolean().optional(),
    briefingCopilot: z.boolean().optional(),
    briefingGraph: z.boolean().optional(),
    briefingInsights: z.boolean().optional(),
    workflowSummary: z.string().optional()
})

export const metricsOptionsSchema = z.object({
    metricsExport: z.string().optional(),
    persistMetrics: z.boolean().optional(),
    metricsPath: z.string().optional(),
    metricsPort: z.string().optional()
})

export const outputOptionsSchema = z.object({
    json: z.boolean().optional()
})

export const serverOptionsSchema = coreOptionsSchema
    .extend(databaseOptionsSchema.shape)
    .extend(workspaceOptionsSchema.shape)
    .extend(vectorOptionsSchema.shape)
    .extend(networkOptionsSchema.shape)
    .extend(oauthOptionsSchema.shape)
    .extend(auditOptionsSchema.shape)
    .extend(codeModeOptionsSchema.shape)
    .extend(pruningOptionsSchema.shape)
    .extend(briefingOptionsSchema.shape)
    .extend(metricsOptionsSchema.shape)

export type ServerOptionsSchema = z.infer<typeof serverOptionsSchema>

export const execOptionsSchema = coreOptionsSchema
    .extend(databaseOptionsSchema.shape)
    .extend(workspaceOptionsSchema.shape)
    .extend(vectorOptionsSchema.shape)
    .extend(codeModeOptionsSchema.shape)
    .extend(auditOptionsSchema.shape)
    .extend(outputOptionsSchema.shape)

export const adminBackupOptionsSchema = z.object({
    dest: z.string().optional()
}).extend(coreOptionsSchema.shape).extend(databaseOptionsSchema.shape).extend(outputOptionsSchema.shape)

export const adminRestoreOptionsSchema = coreOptionsSchema
    .extend(databaseOptionsSchema.shape)
    .extend(outputOptionsSchema.shape)

export const adminVacuumOptionsSchema = coreOptionsSchema
    .extend(databaseOptionsSchema.shape)
    .extend(outputOptionsSchema.shape)

export const adminPruneOptionsSchema = pruningOptionsSchema
    .extend(coreOptionsSchema.shape)
    .extend(databaseOptionsSchema.shape)
    .extend(workspaceOptionsSchema.shape)
    .extend(outputOptionsSchema.shape)
    .extend({
        // Specific overrides from prune command
        archiveOlderThanDays: safeCoerceNonNegativeNumber,
        pruneOlderThanDays: safeCoerceNonNegativeNumber,
        hardDeleteOlderThanDays: safeCoerceNonNegativeNumber,
        importanceThreshold: safeCoerceUnitInterval,
        pruneImportanceThreshold: safeCoerceUnitInterval,
        dryRun: z.boolean().optional(),
        excludeTags: z.string().optional(),
        allWorkspaces: z.boolean().optional(),
    })

export const baseEntryOptionsSchema = z.object({
    file: z.string().optional(),
    contentFile: z.string().optional(),
    content: z.string().optional(),
    body: z.string().optional(),
    description: z.string().optional(),
    title: z.string().optional(),
    summary: z.string().optional(),
    type: z.string().optional(),
    category: z.string().optional(),
    significance: z.string().optional(),
    significanceType: z.string().optional(),
    significance_type: z.string().optional(),
    tags: z.string().optional(),
    tag: z.string().optional(),
    project: safeCoerceDefaultProject,
    projectNumber: safeCoerceDefaultProject,
    project_number: safeCoerceDefaultProject,
    trustScore: safeCoerceNumber,
    trust_score: safeCoerceNumber,
    confidence: safeCoerceNumber,
    impactScore: safeCoerceNumber,
    impact_score: safeCoerceNumber,
    validationStatus: safeCoerceValidationStatus,
    validation_status: safeCoerceValidationStatus,
    validation: safeCoerceValidationStatus,
    workspace: z.string().optional(),
    workspaceId: z.string().optional(),
    workspace_id: z.string().optional(),
    sessionId: z.string().optional(),
    session_id: z.string().optional(),
    relatedTo: z.string().optional(),
    relationships: z.string().optional(),
    relFile: z.string().optional(),
    autoContext: z.string().optional(),
    autoContextFile: z.string().optional(),
    metadata: z.string().optional(),
    autoLink: z.boolean().optional(),
    dryRunLinks: z.boolean().optional(),
    team: z.boolean().optional()
}).extend(coreOptionsSchema.shape).extend(databaseOptionsSchema.shape).extend(outputOptionsSchema.shape)

export type BaseEntryOptionsSchema = z.infer<typeof baseEntryOptionsSchema>

export const createEntryOptionsSchema = baseEntryOptionsSchema

export const updateEntryOptionsSchema = baseEntryOptionsSchema.extend({
    id: safeCoercePositiveInt,
    expectedVersion: safeCoercePositiveInt,
    targetWorkspace: z.string().optional(),
    target_workspace: z.string().optional(),
})

export const searchOptionsSchema = z.object({
    query: z.string().optional(),
    term: z.string().optional(),
    keyword: z.string().optional(),
    mode: z.enum(['auto', 'fts', 'semantic', 'hybrid']).optional(),
    team: z.boolean().optional(),
    limit: safeCoercePositiveInt
}).extend(coreOptionsSchema.shape).extend(databaseOptionsSchema.shape).extend(workspaceOptionsSchema.shape).extend(outputOptionsSchema.shape)

export const ioExportJsonOptionsSchema = z.object({
    dest: z.string().optional()
}).extend(coreOptionsSchema.shape).extend(databaseOptionsSchema.shape).extend(workspaceOptionsSchema.shape).extend(outputOptionsSchema.shape)

export const ioExportMarkdownOptionsSchema = z.object({
    dir: z.string().optional()
}).extend(coreOptionsSchema.shape).extend(databaseOptionsSchema.shape).extend(workspaceOptionsSchema.shape).extend(outputOptionsSchema.shape)

export const ioImportMarkdownOptionsSchema = z.object({
    dir: z.string().optional()
}).extend(coreOptionsSchema.shape).extend(databaseOptionsSchema.shape).extend(workspaceOptionsSchema.shape).extend(outputOptionsSchema.shape)

export const ioImportExternalOptionsSchema = z.object({
    dir: z.string().optional(),
    format: z.enum(['notion', 'obsidian', 'logseq']).optional(),
    limit: safeCoercePositiveInt,
}).extend(coreOptionsSchema.shape).extend(databaseOptionsSchema.shape).extend(workspaceOptionsSchema.shape).extend(outputOptionsSchema.shape)

export const visualizeOptionsSchema = z.object({
    out: z.string().optional(),
    team: z.boolean().optional()
}).extend(coreOptionsSchema.shape).extend(databaseOptionsSchema.shape).extend(workspaceOptionsSchema.shape).extend(outputOptionsSchema.shape)

export const analyticsOptionsSchema = z.object({
    team: z.boolean().optional()
}).extend(coreOptionsSchema.shape).extend(databaseOptionsSchema.shape).extend(workspaceOptionsSchema.shape).extend(outputOptionsSchema.shape)

export const adminAuditSearchOptionsSchema = z.object({
    limit: safeCoercePositiveInt,
    tool: z.string().optional(),
    user: z.string().optional(),
    category: z.enum(['read', 'write', 'admin', 'team', 'audit']).optional(),
    status: z.enum(['success', 'error']).optional()
}).extend(coreOptionsSchema.shape).extend(auditOptionsSchema.shape).extend(outputOptionsSchema.shape)

export const adminRebuildIndexOptionsSchema = z.object({
    team: z.boolean().optional()
}).extend(coreOptionsSchema.shape).extend(databaseOptionsSchema.shape).extend(workspaceOptionsSchema.shape).extend(outputOptionsSchema.shape)


