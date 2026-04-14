/**
 * Memory Journal MCP Server - Database Schema
 *
 * SQL DDL for initialization and input types for the database adapter.
 */

import type { EntryType, SignificanceType } from '../../types/index.js'

/**
 * SQL schema for database initialization.
 * Creates all tables and indexes if they don't already exist.
 */
export const SCHEMA_SQL = `
-- Main journal entries table
CREATE TABLE IF NOT EXISTS memory_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_type TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    is_personal INTEGER DEFAULT 1,
    significance_type TEXT,
    auto_context TEXT,
    deleted_at TEXT,
    -- GitHub integration fields
    project_number INTEGER,
    project_owner TEXT,
    issue_number INTEGER,
    issue_url TEXT,
    pr_number INTEGER,
    pr_url TEXT,
    pr_status TEXT,
    workflow_run_id INTEGER,
    workflow_name TEXT,
    workflow_status TEXT
);

-- Tags table
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    usage_count INTEGER DEFAULT 0
);

-- Junction table for entry-tag relationships
CREATE TABLE IF NOT EXISTS entry_tags (
    entry_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (entry_id, tag_id),
    FOREIGN KEY (entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Relationships between entries
CREATE TABLE IF NOT EXISTS relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_entry_id INTEGER NOT NULL,
    to_entry_id INTEGER NOT NULL,
    relationship_type TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE,
    FOREIGN KEY (to_entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE
);

-- Legacy embeddings table (active embeddings use sqlite-vec vec0 virtual table)
CREATE TABLE IF NOT EXISTS embeddings (
    entry_id INTEGER PRIMARY KEY,
    embedding TEXT NOT NULL,
    model_name TEXT NOT NULL,
    FOREIGN KEY (entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_memory_journal_timestamp ON memory_journal(timestamp);
CREATE INDEX IF NOT EXISTS idx_memory_journal_type ON memory_journal(entry_type);
CREATE INDEX IF NOT EXISTS idx_memory_journal_personal ON memory_journal(is_personal);
CREATE INDEX IF NOT EXISTS idx_memory_journal_deleted ON memory_journal(deleted_at);
CREATE INDEX IF NOT EXISTS idx_memory_journal_project ON memory_journal(project_number);
CREATE INDEX IF NOT EXISTS idx_memory_journal_issue ON memory_journal(issue_number);
CREATE INDEX IF NOT EXISTS idx_memory_journal_pr ON memory_journal(pr_number);
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
CREATE INDEX IF NOT EXISTS idx_entry_tags_entry ON entry_tags(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships(from_entry_id);
CREATE INDEX IF NOT EXISTS idx_relationships_to ON relationships(to_entry_id);

-- Composite covering index for getRecentEntries (WHERE deleted_at IS NULL ORDER BY timestamp DESC, id DESC)
CREATE INDEX IF NOT EXISTS idx_memory_journal_recent ON memory_journal(deleted_at, timestamp DESC, id DESC);

-- Analytics snapshots for persisted digest data across server restarts
CREATE TABLE IF NOT EXISTS analytics_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_type TEXT NOT NULL DEFAULT 'digest',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_type_created
    ON analytics_snapshots(snapshot_type, created_at DESC);

-- FTS5 full-text search index (content-sync: reads from source table, no duplicate storage)
CREATE VIRTUAL TABLE IF NOT EXISTS fts_content USING fts5(
    content,
    content=memory_journal,
    content_rowid=id,
    tokenize='porter unicode61'
);

-- Triggers to keep FTS5 index in sync with memory_journal
CREATE TRIGGER IF NOT EXISTS fts_content_ai AFTER INSERT ON memory_journal BEGIN
    INSERT INTO fts_content(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS fts_content_au AFTER UPDATE OF content ON memory_journal BEGIN
    INSERT INTO fts_content(fts_content, rowid, content) VALUES ('delete', old.id, old.content);
    INSERT INTO fts_content(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS fts_content_ad AFTER DELETE ON memory_journal BEGIN
    INSERT INTO fts_content(fts_content, rowid, content) VALUES ('delete', old.id, old.content);
END;
`

/**
 * Input for creating a new entry
 */
export interface CreateEntryInput {
    content: string
    entryType?: EntryType
    tags?: string[]
    isPersonal?: boolean
    significanceType?: SignificanceType
    autoContext?: string
    /** Optional ISO 8601 timestamp override (defaults to current time) */
    timestamp?: string
    projectNumber?: number
    projectOwner?: string
    issueNumber?: number
    issueUrl?: string
    prNumber?: number
    prUrl?: string
    prStatus?: 'draft' | 'open' | 'merged' | 'closed'
    workflowRunId?: number
    workflowName?: string
    workflowStatus?: 'queued' | 'in_progress' | 'completed'
    author?: string
}

/**
 * SQL migration to add the author column for team databases.
 * Applied after SCHEMA_SQL when initializing a team database.
 */
export const TEAM_SCHEMA_SQL = `
-- Author column for team entries (identifies who shared the entry)
ALTER TABLE memory_journal ADD COLUMN author TEXT;
`

/**
 * Input for creating a team entry (extends standard entry with author)
 */
export interface CreateTeamEntryInput extends CreateEntryInput {
    /** Author name (auto-detected from git config or TEAM_AUTHOR env) */
    author?: string
}
