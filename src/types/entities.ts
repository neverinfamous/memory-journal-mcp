/**
 * Memory Journal MCP Server - Database Entity Types
 */

/**
 * Entry types for journal entries
 */
export const ENTRY_TYPES = [
    'personal_reflection',
    'project_decision',
    'technical_achievement',
    'bug_fix',
    'feature_implementation',
    'code_review',
    'meeting_notes',
    'learning',
    'research',
    'planning',
    'retrospective',
    'standup',
    'technical_note',
    'development_note',
    'enhancement',
    'milestone',
    'system_integration_test',
    'test_entry',
    'plan_draft',
    'adversarial_review',
    'plan_refinement',
    'plan_finalized',
    'copilot_validation',
    'other',
] as const

export type EntryType = typeof ENTRY_TYPES[number]

/**
 * Significance types for important entries
 */
export const SIGNIFICANCE_TYPES = [
    'milestone',
    'breakthrough',
    'decision',
    'architecture',
    'lesson_learned',
    'blocker_resolved',
    'release',
    'security',
] as const

export type SignificanceType = typeof SIGNIFICANCE_TYPES[number] | null

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
export const RELATIONSHIP_TYPES = [
    'evolves_from',
    'references',
    'implements',
    'clarifies',
    'response_to',
    'blocked_by',
    'resolved',
    'caused',
] as const

export type RelationshipType = typeof RELATIONSHIP_TYPES[number]

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
    isArchived: boolean
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
    trustScore?: number
    impactScore?: number
    validationStatus?: 'passed' | 'failed' | 'none'
    // Concurrency versioning
    version: number
    workspaceId?: string
    sessionId?: string | null
}

/**
 * Anchor status representing the validity of an external reference
 */
export type AnchorStatus = 'pending' | 'valid' | 'stale' | 'invalidated' | 'unresolvable'

/**
 * Anchor entity representing a referenced file or dependency
 */
export interface Anchor {
    id?: number
    entryId: number
    anchorPath: string
    anchorType: string
    status: AnchorStatus
    lastCheckedAt?: string
}

/**
 * Entry revision entity for history tracking
 */
export interface EntryRevision {
    id: number
    entryId: number
    revisionNumber: number
    contentSnapshot: string
    changedAt: string
    changedBy: string | null
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
    /** Significance type and impact contribution (weight: 0.30) */
    significance: number
    /** Relationship count contribution (weight: 0.35) */
    relationships: number
    /** Causal relationship contribution (weight: 0.20) */
    causal: number
    /** Recency decay contribution (weight: 0.15) */
    recency: number
    /** Trust and anchor validity contribution (weight modifier) */
    trustModifier?: number
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
