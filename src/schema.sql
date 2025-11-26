-- Memory Journal MCP Server Database Schema
-- Balanced approach: V1 sophistication with V1 simplicity
-- Created: September 2025

-- Core entries table (simplified from V1 but preserving essential patterns)
CREATE TABLE IF NOT EXISTS memory_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_type TEXT NOT NULL DEFAULT 'personal_reflection',
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_personal INTEGER NOT NULL DEFAULT 1,
    share_with_team INTEGER NOT NULL DEFAULT 0,  -- 0=private, 1=shared with team
    
    -- Context bundle information (key V1 pattern)
    project_context TEXT, -- JSON: {repo, branch, files, thread_id}
    related_patterns TEXT, -- Comma-separated tags/patterns
    
    -- GitHub Projects integration (Phase 1)
    project_number INTEGER, -- GitHub Project number
    project_item_id INTEGER, -- GitHub Project item ID
    github_project_url TEXT, -- Full URL to GitHub Project
    
    -- GitHub Issues integration
    issue_number INTEGER, -- GitHub issue number
    issue_url TEXT, -- Full URL to GitHub issue
    
    -- GitHub Pull Requests integration
    pr_number INTEGER, -- Pull request number
    pr_url TEXT, -- Full URL to PR
    pr_status TEXT, -- 'draft', 'open', 'merged', 'closed'
    
    -- GitHub Actions integration
    workflow_run_id INTEGER, -- GitHub Actions workflow run ID
    workflow_name TEXT, -- Workflow name for quick reference
    workflow_status TEXT, -- 'queued', 'in_progress', 'completed'
    
    -- Extensible metadata (JSON for flexibility)
    metadata TEXT,
    
    -- Soft delete support
    deleted_at TEXT,
    
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Tags table (simplified - auto-create capability)
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category TEXT,
    usage_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Entry-tag relationships (many-to-many)
CREATE TABLE IF NOT EXISTS entry_tags (
    entry_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (entry_id, tag_id),
    FOREIGN KEY (entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Relationships between entries (key V1 pattern)
CREATE TABLE IF NOT EXISTS memory_journal_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_entry_id INTEGER NOT NULL,
    target_entry_id INTEGER NOT NULL,
    relationship_type TEXT NOT NULL DEFAULT 'related_to',
    relationship_strength REAL DEFAULT 0.5,
    bidirectional INTEGER DEFAULT 0,
    metadata TEXT, -- JSON for additional relationship info
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE,
    FOREIGN KEY (target_entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE
);

-- Simplified relationships table for direct entry linking
CREATE TABLE IF NOT EXISTS relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_entry_id INTEGER NOT NULL,
    to_entry_id INTEGER NOT NULL,
    relationship_type TEXT NOT NULL DEFAULT 'references',
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE,
    FOREIGN KEY (to_entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE
);

-- Significant entries (key V1 pattern for important moments)
CREATE TABLE IF NOT EXISTS significant_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    significance_type TEXT NOT NULL,
    significance_rating REAL DEFAULT 0.5,
    notes TEXT,
    related_entries TEXT, -- JSON array of related entry IDs
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE
);

-- Relationship types (from V1 system)
CREATE TABLE IF NOT EXISTS relationship_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    direction TEXT DEFAULT 'one-way', -- 'one-way' or 'bidirectional'
    category TEXT
);

-- Full-text search (FTS5 for powerful search)
CREATE VIRTUAL TABLE IF NOT EXISTS memory_journal_fts USING fts5(
    content,
    entry_type,
    related_patterns,
    content='memory_journal',
    content_rowid='id'
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_memory_journal_timestamp ON memory_journal(timestamp);
CREATE INDEX IF NOT EXISTS idx_memory_journal_type ON memory_journal(entry_type);
CREATE INDEX IF NOT EXISTS idx_memory_journal_personal ON memory_journal(is_personal);
CREATE INDEX IF NOT EXISTS idx_memory_journal_updated ON memory_journal(updated_at);
CREATE INDEX IF NOT EXISTS idx_memory_journal_deleted ON memory_journal(deleted_at);
CREATE INDEX IF NOT EXISTS idx_memory_journal_project_number ON memory_journal(project_number);
CREATE INDEX IF NOT EXISTS idx_memory_journal_project_item_id ON memory_journal(project_item_id);
CREATE INDEX IF NOT EXISTS idx_memory_journal_issue_number ON memory_journal(issue_number);
CREATE INDEX IF NOT EXISTS idx_memory_journal_pr_number ON memory_journal(pr_number);
CREATE INDEX IF NOT EXISTS idx_memory_journal_workflow_run_id ON memory_journal(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_entry_tags_entry ON entry_tags(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_relationships_source ON memory_journal_relationships(source_entry_id);
CREATE INDEX IF NOT EXISTS idx_relationships_target ON memory_journal_relationships(target_entry_id);
CREATE INDEX IF NOT EXISTS idx_relationships_type ON memory_journal_relationships(relationship_type);
CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships(from_entry_id);
CREATE INDEX IF NOT EXISTS idx_relationships_to ON relationships(to_entry_id);
CREATE INDEX IF NOT EXISTS idx_significant_entries_type ON significant_entries(significance_type);

-- Triggers for updated_at and FTS sync
CREATE TRIGGER IF NOT EXISTS update_memory_journal_timestamp 
AFTER UPDATE ON memory_journal
BEGIN
    UPDATE memory_journal SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS memory_journal_fts_insert
AFTER INSERT ON memory_journal
BEGIN
    INSERT INTO memory_journal_fts(rowid, content, entry_type, related_patterns)
    VALUES (NEW.id, NEW.content, NEW.entry_type, NEW.related_patterns);
END;

CREATE TRIGGER IF NOT EXISTS memory_journal_fts_update
AFTER UPDATE ON memory_journal
BEGIN
    UPDATE memory_journal_fts SET 
        content = NEW.content,
        entry_type = NEW.entry_type,
        related_patterns = NEW.related_patterns
    WHERE rowid = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS memory_journal_fts_delete
AFTER DELETE ON memory_journal
BEGIN
    DELETE FROM memory_journal_fts WHERE rowid = OLD.id;
END;

-- Insert default relationship types (from V1 system)
INSERT OR IGNORE INTO relationship_types (name, description, direction, category) VALUES
('evolves_from', 'Entry represents evolution from target', 'one-way', 'development'),
('references', 'Entry explicitly references target', 'one-way', 'citation'),
('related_to', 'Entries are thematically related', 'bidirectional', 'association'),
('implements', 'Entry implements concepts from target', 'one-way', 'technical'),
('associated_with', 'Entries are contextually associated', 'bidirectional', 'context'),
('clarifies', 'Entry clarifies concepts in target', 'one-way', 'explanation'),
('contradicts', 'Entry challenges or contradicts target', 'one-way', 'conflict'),
('response_to', 'Entry directly responds to target', 'one-way', 'dialogue');

-- Insert common entry types
INSERT OR IGNORE INTO tags (name, category) VALUES
('consciousness', 'core'),
('technical-integration', 'core'),
('development', 'core'),
('growth', 'core'),
('collaboration', 'core'),
('milestone', 'achievement'),
('reflection', 'type'),
('identity', 'core'),
('mathematics', 'domain'),
('linguistics', 'domain'),
('temporal', 'type');

-- Vector embeddings table for semantic search
CREATE TABLE IF NOT EXISTS memory_journal_embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    embedding_model TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
    embedding_vector BLOB NOT NULL,
    embedding_dimension INTEGER NOT NULL DEFAULT 384,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (entry_id) REFERENCES memory_journal (id) ON DELETE CASCADE
);

-- Index for faster embedding lookups
CREATE INDEX IF NOT EXISTS idx_embeddings_entry_id ON memory_journal_embeddings(entry_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_model ON memory_journal_embeddings(embedding_model);

-- Trigger to automatically generate embeddings for new entries
CREATE TRIGGER IF NOT EXISTS memory_journal_embedding_insert
AFTER INSERT ON memory_journal
BEGIN
    -- Note: Actual embedding generation will be handled by the server
    -- This trigger serves as a placeholder for future automatic embedding generation
    SELECT 1; -- Valid SQL statement that does nothing
END;

-- GitHub Project Cache (Phase 2 - Issue #16)
-- Cache GitHub API responses to reduce API calls and improve performance
CREATE TABLE IF NOT EXISTS github_project_cache (
    cache_key TEXT PRIMARY KEY,
    cache_value TEXT NOT NULL,
    cached_at INTEGER NOT NULL,
    ttl_seconds INTEGER NOT NULL
);

-- Index for cache expiration cleanup
CREATE INDEX IF NOT EXISTS idx_cache_expiry ON github_project_cache(cached_at, ttl_seconds);