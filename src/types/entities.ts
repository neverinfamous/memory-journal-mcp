/**
 * Memory Journal MCP Server - Database Entity Types
 */

/**
 * Entry types for journal entries
 */
export type EntryType =
    | 'personal_reflection'
    | 'project_decision'
    | 'technical_achievement'
    | 'bug_fix'
    | 'feature_implementation'
    | 'code_review'
    | 'meeting_notes'
    | 'learning'
    | 'research'
    | 'planning'
    | 'retrospective'
    | 'standup'
    | 'technical_note'
    | 'development_note'
    | 'enhancement'
    | 'milestone'
    | 'flag'
    | 'system_integration_test'
    | 'test_entry'
    | 'other'

/**
 * Significance types for important entries
 */
export type SignificanceType =
    | 'milestone'
    | 'breakthrough'
    | 'technical_breakthrough'
    | 'decision'
    | 'lesson_learned'
    | 'blocker_resolved'
    | 'release'
    | null

/**
 * Relationship types between entries
 *
 * Standard types:
 * - evolves_from: Entry builds upon previous work
 * - references: Entry mentions or links to another
 * - implements: Entry implements a spec/design
 * - clarifies: Entry explains or clarifies another
 * - response_to: Entry responds to a question/issue
 *
 * Causal types (for decision tracing):
 * - blocked_by: Entry was blocked by another (e.g., blocker → resolution)
 * - resolved: Entry resolved/fixed an issue from another
 * - caused: Entry caused or led to another outcome
 */
export type RelationshipType =
    | 'evolves_from'
    | 'references'
    | 'implements'
    | 'clarifies'
    | 'response_to'
    | 'blocked_by'
    | 'resolved'
    | 'caused'

/**
 * Journal entry entity
 */
export interface JournalEntry {
    id: number
    entryType: EntryType
    content: string
    timestamp: string
    isPersonal: boolean
    significanceType: SignificanceType
    autoContext: string | null
    deletedAt: string | null
    tags: string[]
    // GitHub integration fields
    projectNumber?: number | null
    projectOwner?: string | null
    issueNumber?: number | null
    issueUrl?: string | null
    prNumber?: number | null
    prUrl?: string | null
    prStatus?: string | null
    workflowRunId?: number | null
    workflowName?: string | null
    workflowStatus?: string | null
    // Analytics & search
    importanceScore?: number
}

/**
 * Tag entity
 */
export interface Tag {
    id: number
    name: string
    usageCount: number
}

/**
 * Relationship entity
 */
export interface Relationship {
    id: number
    fromEntryId: number
    toEntryId: number
    relationshipType: RelationshipType
    description: string | null
    createdAt: string
}

/**
 * Embedding entity for vector search
 */
export interface Embedding {
    entryId: number
    embedding: Float32Array
    modelName: string
}

/**
 * Importance scoring breakdown showing weighted component contributions
 */
export interface ImportanceBreakdown {
    /** Significance type contribution (weight: 0.30) */
    significance: number
    /** Relationship count contribution (weight: 0.35) */
    relationships: number
    /** Causal relationship contribution (weight: 0.20) */
    causal: number
    /** Recency decay contribution (weight: 0.15) */
    recency: number
}

/**
 * Importance calculation result with total score and component breakdown
 */
export interface ImportanceResult {
    /** Total importance score (0.0-1.0) */
    score: number
    /** Weighted component contributions */
    breakdown: ImportanceBreakdown
}
