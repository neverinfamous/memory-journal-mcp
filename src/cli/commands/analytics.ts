import type { Command } from 'commander'
import { type z } from 'zod'
import { analyticsOptionsSchema } from '../schemas.js'
import { getCliCommandDb as getDb, resolveCliReadScope } from './db-helper.js'

export const analyticsSchema = analyticsOptionsSchema

export async function analyticsStatsAction(options: z.infer<typeof analyticsSchema>, command: Command): Promise<void> {
    const { db, serverOptions } = await getDb(options, command)
    let failed = false
    try {
        const { workspaceId, projectNumber } = resolveCliReadScope(db, serverOptions, options)
        const result = db.getStatistics(
            undefined,
            undefined,
            undefined,
            undefined,
            workspaceId,
            projectNumber
        )
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } catch (e) {
        failed = true
        process.stderr.write("Analytics stats failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
    } finally {
        db.close()
    }
    if (failed) {
        process.exit(1)
    }
}

export async function analyticsInsightsAction(options: z.infer<typeof analyticsSchema>, command: Command): Promise<void> {
    const { db, serverOptions } = await getDb(options, command)
    let failed = false
    try {
        const { workspaceId, projectNumber } = resolveCliReadScope(db, serverOptions, options)
        const result = db.getCrossProjectInsights({
            minEntries: 1,
            inactiveThresholdDays: 30,
            ...(workspaceId !== undefined ? { workspaceId } : {}),
            ...(projectNumber !== undefined ? { projectNumber } : {}),
        })
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } catch (e) {
        failed = true
        process.stderr.write("Analytics insights failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
    } finally {
        db.close()
    }
    if (failed) {
        process.exit(1)
    }
}
