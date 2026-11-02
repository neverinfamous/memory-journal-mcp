import type { JournalEntry } from '../../types/index.js'
import type { NativeConnectionManager } from './native-connection.js'
import {
    getWorkflowActionEntries,
    getSignificantEntries,
    saveAnalyticsDigest,
    getLatestAnalyticsDigest,
    getAnalyticsSnapshots,
    computeDigest,
} from './insights/entry-digest-queries.js'
import {
    getCrossProjectInsights,
    visualizeRelationships,
    getRecentGraphRelationships,
} from './insights/cross-project.js'
import {
    getAuthorStatistics,
    getAuthorsForEntries,
    getTeamCollaborationMetrics,
} from './insights/team-collaboration.js'

export class InsightsOperations {
    constructor(private connection: NativeConnectionManager) {}

    getWorkflowActionEntries(limit: number, workspaceId?: string): JournalEntry[] {
        return getWorkflowActionEntries(this.connection, limit, workspaceId)
    }

    getSignificantEntries(
        limit: number,
        projectNumber?: number,
        workspaceId?: string
    ): JournalEntry[] {
        return getSignificantEntries(this.connection, limit, projectNumber, workspaceId)
    }

    getRecentGraphRelationships(limit: number): ReturnType<typeof getRecentGraphRelationships> {
        return getRecentGraphRelationships(this.connection, limit)
    }

    getAuthorStatistics(workspaceId?: string): { author: string; count: number }[] {
        return getAuthorStatistics(this.connection, workspaceId)
    }

    getAuthorsForEntries(entryIds: number[]): Map<number, string | null> {
        return getAuthorsForEntries(this.connection, entryIds)
    }

    saveAnalyticsSnapshot(type: string, data: Record<string, unknown>): number {
        return saveAnalyticsDigest(this.connection, type, data)
    }

    getLatestAnalyticsSnapshot(
        type: string
    ): { id: number; createdAt: string; data: Record<string, unknown> } | null {
        return getLatestAnalyticsDigest(this.connection, type)
    }

    getAnalyticsSnapshots(
        type: string,
        limit?: number
    ): { id: number; createdAt: string; data: Record<string, unknown> }[] {
        return getAnalyticsSnapshots(this.connection, type, limit)
    }

    computeDigest(workspaceId?: string): Record<string, unknown> {
        return computeDigest(this.connection, workspaceId)
    }

    getCrossProjectInsights(options: {
        startDate?: string
        endDate?: string
        minEntries: number
        inactiveThresholdDays: number
        workspaceId?: string
    }): ReturnType<typeof getCrossProjectInsights> {
        return getCrossProjectInsights(this.connection, options)
    }

    visualizeRelationships(options: {
        entryId?: number
        tags?: string[]
        relationshipType?: string
        depth: number
        limit: number
    }): ReturnType<typeof visualizeRelationships> {
        return visualizeRelationships(this.connection, options)
    }

    getTeamCollaborationMatrix(options: {
        period: string
        limit: number
    }): ReturnType<typeof getTeamCollaborationMetrics> {
        return getTeamCollaborationMetrics(this.connection, options)
    }
}
