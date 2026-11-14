/**
 * Shared Schema Help Metadata (L4 SSoT)
 *
 * Centralizes `mj.schema` metadata shared across sandbox bindings,
 * worker proxy namespaces, and worker namespace shims.
 */

import {
    ENTRY_TYPES,
    SIGNIFICANCE_TYPES,
} from '../../handlers/tools/schemas/constants-and-primitives.js'

export const JOURNAL_TABLES = [
    'memory_journal',
    'tags',
    'entry_tags',
    'relationships',
    'entry_anchors',
    'entry_revisions',
    'vec_embeddings',
    'team_flags',
]

export interface SchemaHelpPayload {
    group: 'schema'
    description: string
    tables: string[]
    entrySchema: Record<string, string>
    methods: string[]
    usage: string
}

/** Build the canonical `mj.schema.help()` payload. */
export function buildSchemaHelpPayload(usage?: string): SchemaHelpPayload {
    return {
        group: 'schema',
        description:
            'Memory Journal Schema: Embedded SQLite database storing journal entries, tags, relationships, code anchors, revisions, vector embeddings, and team flags.',
        tables: JOURNAL_TABLES,
        entrySchema: {
            id: 'number (auto-increment primary key)',
            content: 'string (required, markdown body)',
            entry_type: ENTRY_TYPES.map((t) => `'${t}'`).join(' | '),
            timestamp: 'string (ISO 8601 timestamp)',
            is_personal: 'boolean (default: true)',
            significance_type: `optional (${SIGNIFICANCE_TYPES.map((t) => `'${t}'`).join(' | ')})`,
            tags: 'string[] (optional array of kebab-case tags)',
            workspace_id: 'string (required repository/workspace identifier)',
            project_number: 'number (optional GitHub project number)',
            impact_score: 'number (0.0-1.0 blast radius score)',
            trust_score: 'number (0.0-1.0 confidence score)',
            validation_status: "'passed' | 'none' | 'failed'",
            auto_context: 'string (optional JSON metadata string, e.g. { "commits": ["<sha>"] })',
            session_id: 'string (optional session tracking id)',
            relationships: 'Array<{ targetId: number, relationType?: string }> (optional entry links)',
            anchors: 'Array<{ anchor_path: string, anchor_type: string, status?: string }> (optional code anchors)',
        },
        methods: ['help', 'describe', 'listTables', 'describeTable', 'getSchema'],
        usage:
            usage ??
            'Call mj.core.createEntry.schema() for entry parameter details, or mj.analytics.getStatistics() for database statistics.',
    }
}

/** Return resolved schema help payload for `mj.schema`. */
export function getSchemaHelp(usage?: string): Promise<SchemaHelpPayload> {
    return Promise.resolve(buildSchemaHelpPayload(usage))
}

/** Return resolved table list for `mj.schema.listTables()`. */
export function listJournalTables(): Promise<{ success: boolean; tables: string[] }> {
    return Promise.resolve({ success: true, tables: JOURNAL_TABLES })
}
