# Memory Journal MCP v1.1.0 - Production/Stable 🎉

## 🌟 Major Release Highlights

Memory Journal MCP has graduated from **Beta to Production/Stable**! This release introduces powerful relationship mapping and visualization features, along with significant performance improvements.

## ✨ New Features

### Entry Relationships
- **Link entries** with typed relationships (references, implements, clarifies, evolves_from, response_to)
- **Build knowledge graphs** of your work
- **Track how ideas evolve** over time
- New tool: `link_entries` for creating relationships
- Enhanced `get_entry_by_id` to show relationships

### Relationship Visualization
- **Generate Mermaid diagrams** showing entry connections
- **Multiple visualization modes**: entry-centric, tag-based, recent activity
- **Depth control** for graph traversal (1-3 hops)
- **Color-coded nodes**: Personal (blue) vs Project (orange)
- **Typed arrows**: Different styles for different relationship types
- New tool: `visualize_relationships`
- New resource: `memory://graph/recent`

### Performance Improvements
- **10x faster startup**: 14s → 2-3s through lazy loading
- **Lazy ML imports**: Model loads only on first semantic search
- **Optimized database**: Removed expensive PRAGMA operations from startup
- **Thread-safe operations**: Fixed database locking issues

## 🔧 Improvements

### Database
- New `relationships` table with cascading deletes
- Soft delete support via `deleted_at` column
- Automatic schema migrations for upgrades
- Enhanced indexes for relationship queries

### Tools (Now 15!)
- `create_entry` - Enhanced with relationship support
- `update_entry` - Thread-safe tag creation
- `delete_entry` - Soft delete option
- `get_entry_by_id` - Shows relationships
- `link_entries` - **NEW** Create typed relationships
- `visualize_relationships` - **NEW** Generate Mermaid diagrams
- Plus 9 existing tools (search, export, analytics, etc.)

### Resources (Now 3!)
- `memory://recent` - Recent entries
- `memory://significant` - Significant entries
- `memory://graph/recent` - **NEW** Relationship graph

### Documentation
- **Complete GitHub Wiki** with 17 comprehensive pages
- Installation, Quick Start, Tools, Prompts, Examples
- Architecture, Schema, Performance, Security guides
- Visualization, Relationships, Search tutorials
- Updated README with v1.1.0 features

## 🐛 Bug Fixes
- Fixed database locking with concurrent tag updates
- Fixed Mermaid arrow syntax (-->> → -->)
- Improved error handling for Git operations
- Better handling of soft-deleted entries

## 📚 Documentation Links
- **Wiki**: https://github.com/neverinfamous/memory-journal-mcp/wiki
- **PyPI**: https://pypi.org/project/memory-journal-mcp/1.1.0/
- **Docker Hub**: https://hub.docker.com/r/writenotenow/memory-journal-mcp

## 📦 Installation

```bash
# PyPI
pip install memory-journal-mcp

# Docker
docker pull writenotenow/memory-journal-mcp:latest
```

## 🔄 Upgrading from v1.0.x

Automatic schema migration! Simply:
1. Update the package: `pip install --upgrade memory-journal-mcp`
2. Restart your MCP client
3. Database auto-migrates on first run

## 🎯 What's Next

Memory Journal is now **Production/Stable** and ready for daily use! Future enhancements planned:
- Interactive visualization
- Timeline views
- More export formats
- Enhanced Git integration

## 👏 Thank You

Special thanks to all early adopters who provided feedback during the beta phase!

---

**Full Changelog**: https://github.com/neverinfamous/memory-journal-mcp/compare/v1.0.2...v1.1.0

