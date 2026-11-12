import type { Command } from 'commander'
import { type z } from 'zod'
import { analyticsOptionsSchema } from '../schemas.js'
import { getCliCommandDb as getDb } from './db-helper.js'
import { resolveWorkspaceId } from '../../utils/workspace-resolver.js'

export const analyticsSchema = analyticsOptionsSchema

export async function analyticsStatsAction(options: z.infer<typeof analyticsSchema>, command: Command): Promise<void> {
    const { db, serverOptions } = await getDb(options, command)
    try {
        const requestedProject = options.defaultProject
        const workspaceId = resolveWorkspaceId(
            options.workspace,
            requestedProject ?? serverOptions.defaultProjectNumber,
            serverOptions
        )
        const result = db.getStatistics(
            undefined,
            undefined,
            undefined,
            undefined,
            workspaceId,
            requestedProject
        )
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } catch (e) {
        process.stderr.write("Analytics stats failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}

export async function analyticsInsightsAction(options: z.infer<typeof analyticsSchema>, command: Command): Promise<void> {
    const { db, serverOptions } = await getDb(options, command)
    try {
        const requestedProject = options.defaultProject
        const workspaceId = resolveWorkspaceId(
            options.workspace,
            requestedProject ?? serverOptions.defaultProjectNumber,
            serverOptions
        )
        const result = db.getCrossProjectInsights({
            minEntries: 1,
            inactiveThresholdDays: 30,
            ...(workspaceId !== undefined ? { workspaceId } : {}),
            ...(requestedProject !== undefined ? { projectNumber: requestedProject } : {}),
        })
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } catch (e) {
        process.stderr.write("Analytics insights failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}
