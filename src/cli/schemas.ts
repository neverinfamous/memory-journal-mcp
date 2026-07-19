import { z } from 'zod'

export const coreOptionsSchema = z.object({
    config: z.string().optional(),
    dumpConfig: z.boolean().optional(),
    logLevel: z.string().optional()
})

export const databaseOptionsSchema = z.object({
    db: z.string().optional(),
    teamDb: z.string().optional(),
    additionalTeamDbs: z.string().optional(),
    teamDefaultRole: z.string().optional(),
    teamAdmin: z.string().optional()
})

export const workspaceOptionsSchema = z.object({
    defaultProject: z.coerce.number().optional(),
    defaultWorkspaceId: z.string().optional()
})

export const vectorOptionsSchema = z.object({
    embeddingModel: z.string().optional(),
    autoRebuildIndex: z.boolean().optional()
})

export const networkOptionsSchema = z.object({
    transport: z.string().optional(),
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

export const schedulerOptionsSchema = z.object({
    backupInterval: z.string().optional(),
    keepBackups: z.string().optional(),
    vacuumInterval: z.string().optional(),
    rebuildIndexInterval: z.string().optional(),
    digestInterval: z.string().optional(),
    reportInterval: z.string().optional(),
    reportWebhookUrl: z.string().optional(),
    reportWebhookAuth: z.string().optional(),
    reportContentType: z.string().optional()
})

export const pruningOptionsSchema = z.object({
    autoPruneInterval: z.string().optional(),
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
    .extend(schedulerOptionsSchema.shape)
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
    .extend(outputOptionsSchema.shape)
    .extend({
        // Specific overrides from prune command
        archiveOlderThanDays: z.coerce.number().optional(),
        pruneOlderThanDays: z.coerce.number().optional(),
        hardDeleteOlderThanDays: z.coerce.number().optional(),
        importanceThreshold: z.coerce.number().optional(),
        dryRun: z.boolean().optional(),
        excludeTags: z.string().optional()
    })

export const baseEntryOptionsSchema = z.object({
    file: z.string().optional(),
    content: z.string().optional(),
    description: z.string().optional(),
    title: z.string().optional(),
    type: z.string().optional(),
    category: z.string().optional(),
    tags: z.string().optional(),
    project: z.coerce.number().optional(),
    project_number: z.coerce.number().optional(),
    trustScore: z.coerce.number().optional(),
    trust_score: z.coerce.number().optional(),
    impactScore: z.coerce.number().optional(),
    impact_score: z.coerce.number().optional(),
    validationStatus: z.enum(['passed', 'failed', 'none']).optional(),
    sessionId: z.string().optional(),
    session_id: z.string().optional(),
    relatedTo: z.string().optional(),
    relationships: z.string().optional(),
    relFile: z.string().optional(),
    autoContext: z.string().optional(),
    autoContextFile: z.string().optional(),
    metadata: z.string().optional(),
    team: z.boolean().optional()
}).extend(coreOptionsSchema.shape).extend(databaseOptionsSchema.shape).extend(outputOptionsSchema.shape)

export type BaseEntryOptionsSchema = z.infer<typeof baseEntryOptionsSchema>

export const createEntryOptionsSchema = baseEntryOptionsSchema

export const updateEntryOptionsSchema = baseEntryOptionsSchema.extend({
    id: z.coerce.number(),
    expectedVersion: z.coerce.number()
})

export const searchOptionsSchema = z.object({
    query: z.string().optional(),
    term: z.string().optional(),
    keyword: z.string().optional(),
    mode: z.enum(['auto', 'fts', 'semantic', 'hybrid']).optional(),
    team: z.boolean().optional(),
    limit: z.coerce.number().optional()
}).extend(coreOptionsSchema.shape).extend(databaseOptionsSchema.shape).extend(outputOptionsSchema.shape)

export const ioExportJsonOptionsSchema = z.object({
    dest: z.string().optional()
}).extend(coreOptionsSchema.shape).extend(databaseOptionsSchema.shape).extend(outputOptionsSchema.shape)

export const ioExportMarkdownOptionsSchema = z.object({
    dir: z.string().optional()
}).extend(coreOptionsSchema.shape).extend(databaseOptionsSchema.shape).extend(outputOptionsSchema.shape)

export const ioImportMarkdownOptionsSchema = z.object({
    dir: z.string().optional()
}).extend(coreOptionsSchema.shape).extend(databaseOptionsSchema.shape).extend(outputOptionsSchema.shape)

export const ioImportExternalOptionsSchema = z.object({
    dir: z.string().optional(),
    format: z.enum(['notion', 'obsidian']).optional()
}).extend(coreOptionsSchema.shape).extend(databaseOptionsSchema.shape).extend(outputOptionsSchema.shape)

export const visualizeOptionsSchema = z.object({
    out: z.string().optional(),
    team: z.boolean().optional()
}).extend(coreOptionsSchema.shape).extend(databaseOptionsSchema.shape)

export const analyticsOptionsSchema = z.object({
    team: z.boolean().optional()
}).extend(coreOptionsSchema.shape).extend(databaseOptionsSchema.shape).extend(outputOptionsSchema.shape)

export const adminAuditSearchOptionsSchema = z.object({
    limit: z.coerce.number().optional(),
    tool: z.string().optional(),
    user: z.string().optional(),
    category: z.string().optional(),
    status: z.enum(['success', 'error']).optional()
}).extend(coreOptionsSchema.shape).extend(databaseOptionsSchema.shape).extend(auditOptionsSchema.shape).extend(outputOptionsSchema.shape)

export const adminRebuildIndexOptionsSchema = z.object({
    team: z.boolean().optional()
}).extend(coreOptionsSchema.shape).extend(databaseOptionsSchema.shape).extend(outputOptionsSchema.shape)


