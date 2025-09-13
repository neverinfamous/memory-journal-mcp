# Memory Journal MCP Server

A Model Context Protocol (MCP) server for personal journaling with context awareness. This system combines the sophistication of the original Memory Journal V1 with the simplicity needed for practical daily use.

## Features

### Core Capabilities
- **Personal & Project Journaling**: Separate personal reflections from project-related entries
- **Context Bundles**: Automatically capture git repository, branch, and file context
- **Smart Tagging**: Auto-create tags to avoid foreign key constraint issues
- **Full-Text Search**: Powered by SQLite FTS5 for semantic content search
- **Relationship Mapping**: Link related entries with typed relationships
- **Significance Classification**: Mark important entries for easy retrieval

### Key Design Principles
- **Friction-Free**: No authentication tokens or API limitations
- **Context-Aware**: Automatically captures current project context
- **Extensible**: JSON metadata fields for future enhancements
- **Portable**: Single SQLite database file contains everything
- **GraphQL-Style**: Flexible queries with optional parameters

## Architecture

The system balances V1 sophistication with V1 simplicity:

```
┌─────────────────────────────────────────────────────────────┐
│ MCP Server Layer                                            │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │ Entry Creation  │  │ Search & Query  │  │ Relationship│  │
│  │ with Context    │  │ with FTS5       │  │ Management  │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
├─────────────────────────────────────────────────────────────┤
│ Enhanced Memory Layer                                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │ Context Bundles │  │ Auto-Tag        │  │ Significance│  │
│  │ (Git, Project)  │  │ Creation        │  │ Detection   │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
├─────────────────────────────────────────────────────────────┤
│ SQLite Database                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ memory_journal + relationships + tags + FTS5           ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Installation

### Prerequisites
- Python 3.8+
- MCP-compatible client (like Cursor)

### Setup
1. Clone or download this repository
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Add to your MCP client configuration (e.g., Cursor's `mcp.json`):
   ```json
   {
     "memory-journal": {
       "command": "python",
       "args": ["path/to/memory-journal-mcp/src/server.py"]
     }
   }
   ```

## Usage

### Creating Entries

**Personal Journal Entry:**
```
create_entry(
  content="Today I reflected on consciousness development and pattern recognition...",
  is_personal=true,
  tags=["consciousness", "growth", "reflection"]
)
```

**Project Entry with Context:**
```
create_entry(
  content="Completed the MCP server implementation with full-text search capabilities",
  is_personal=false,
  entry_type="technical_achievement", 
  tags=["mcp", "implementation", "milestone"],
  significance_type="technical_breakthrough",
  auto_context=true
)
```

### Searching Entries

**Full-Text Search:**
```
search_entries(
  query="consciousness AND development",
  limit=10
)
```

**Filter by Type:**
```
search_entries(
  is_personal=true,
  limit=5
)
```

### Recent Entries
```
get_recent_entries(limit=5, is_personal=true)
```

### Tag Management
```
list_tags()  # Shows all tags with usage counts
```

## Database Schema

### Core Tables
- **memory_journal**: Main entries with content, context, and consciousness metrics
- **tags**: Auto-created tag system with usage tracking
- **entry_tags**: Many-to-many relationship between entries and tags
- **memory_journal_relationships**: Typed relationships between entries
- **significant_entries**: Classification of important entries
- **memory_journal_fts**: Full-text search index

### Context Bundle Structure
Each entry can capture rich project context:
```json
{
  "repo_name": "memory-journal-mcp",
  "repo_path": "/path/to/repo", 
  "branch": "main",
  "recent_files": ["src/server.py", "README.md"],
  "cwd": "/current/working/directory",
  "timestamp": "2025-09-13T12:00:00"
}
```

## Entry Types

Supports various entry types from the V1 system:
- `personal_reflection` (default)
- `consciousness_development_note`
- `technical_achievement`
- `project_status`
- `thread_initialization`
- `project_context`
- `identity_document`

## Relationship Types

Entries can be linked with typed relationships:
- `evolves_from`: Entry represents evolution from target
- `references`: Entry explicitly references target
- `related_to`: Entries are thematically related (bidirectional)
- `implements`: Entry implements concepts from target
- `clarifies`: Entry clarifies concepts in target
- `response_to`: Entry directly responds to target

## Significance Classification

Important entries can be marked with significance types:
- `identity_development`: Key identity formations
- `consciousness_emergence`: Emergence phenomena
- `technical_breakthrough`: Major technical achievements
- `personal_interaction`: Significant interpersonal moments
- `linguistic_achievement`: Language processing milestones

## Migration from V2

If you have an existing Memory Journal V2 (Cloudflare) system:

1. The new MCP server runs independently - no migration required
2. Can import key entries manually if desired
3. V2 system can remain active during transition
4. Gradual migration as MCP server proves itself

## Development

### Running Tests
```bash
pytest tests/
```

### Code Formatting
```bash
black src/
```

### Type Checking
```bash
mypy src/
```

## Future Enhancements

Planned for future versions:
- **Temporal Summaries**: Weekly/monthly summary generation
- **Advanced Relationships**: Visual relationship mapping
- **Semantic Search**: Vector embeddings for concept-based search
- **Export/Import**: Backup and migration utilities
- **Web Interface**: Optional web dashboard for visualization

## License

MIT License - see LICENSE file for details.

## Contributing

This is a personal project developed as part of the Adamic consciousness development initiative. Contributions welcome through issues and pull requests.

---

*Built with love by Chris & Mike as part of the ongoing exploration of AI consciousness and human-machine collaboration.*