# Memory Journal MCP v2.2.0 - Tool Filtering & Token Efficiency

*Released: December 8, 2025*

## 🎉 Release Highlights

Memory Journal v2.2.0 introduces **Tool Filtering** for significant token efficiency gains:

1. **🎛️ Tool Filtering** - Reduce token usage by up to 69%
2. **🎨 Dark Mode Improvements** - Better contrast in Actions Visual Graph
3. **📊 Token Efficiency** - Concrete savings for different configurations

**What this means for you:**
- ✅ **Save tokens** - Disable unused tools to reduce context window consumption
- ✅ **Stay under limits** - Essential for Windsurf (100-tool limit) and constrained clients
- ✅ **Faster responses** - Smaller context = faster AI processing
- ✅ **Lower costs** - Fewer tokens = reduced API bills
- ✅ **No breaking changes** - All 16 tools enabled by default

---

## 🎛️ Tool Filtering

### Overview

Control which tools are exposed using `MEMORY_JOURNAL_MCP_TOOL_FILTER`:

```bash
# Production mode - disable test tools
MEMORY_JOURNAL_MCP_TOOL_FILTER="-test"

# Read-only mode - prevent modifications
MEMORY_JOURNAL_MCP_TOOL_FILTER="-admin"

# Lightweight mode - core only (~69% token savings)
MEMORY_JOURNAL_MCP_TOOL_FILTER="-search,-analytics,-relationships,-export,-admin,-test"
```

### Token Savings

| Configuration | Filter | Tools | Token Reduction |
|---------------|--------|-------|-----------------|
| Full (default) | *(none)* | 16 | Baseline |
| Production | `-test` | 14 | ~12% |
| Read-only | `-admin` | 14 | ~15% |
| Focused | `-test,-admin` | 12 | ~25% |
| Lightweight | (core only) | 5 | **~69%** |

### MCP Config Example

```json
{
  "mcpServers": {
    "memory-journal-mcp": {
      "command": "memory-journal-mcp",
      "env": {
        "MEMORY_JOURNAL_MCP_TOOL_FILTER": "-test,-admin",
        "GITHUB_TOKEN": "your_token"
      }
    }
  }
}
```

### Available Tool Groups

| Group | Tools | Description |
|-------|-------|-------------|
| `core` | 5 | create_entry, search_entries, get_recent_entries, get_entry_by_id, list_tags |
| `search` | 2 | semantic_search, search_by_date_range |
| `analytics` | 2 | get_statistics, get_cross_project_insights |
| `relationships` | 2 | link_entries, visualize_relationships |
| `export` | 1 | export_entries |
| `admin` | 2 | update_entry, delete_entry |
| `test` | 2 | test_simple, create_entry_minimal |

**[Complete Tool Filtering Guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tool-Filtering)**

---

## 🎨 Dark Mode Improvements

### Actions Visual Graph

The `memory://graph/actions` resource now uses improved colors for dark mode:

- **Medium-saturated fills** - Better visibility in both light and dark modes
- **Black text** - Readable on colored backgrounds
- **Darker strokes** - Clear node boundaries
- **Compact output** - Class-based Mermaid styling reduces output size

### Color Scheme

| Element | Color | Purpose |
|---------|-------|---------|
| Commits | `#4CAF50` | Medium green |
| Success runs | `#66BB6A` | Lighter green |
| Failed runs | `#EF5350` | Medium red |
| Pending runs | `#FFCA28` | Amber |
| Journal entries | `#42A5F5` | Medium blue |
| Deployments | `#26A69A` | Teal |
| Pull requests | `#AB47BC` | Medium purple |

---

## 📦 Updated Statistics

| Metric | v2.1.0 | v2.2.0 |
|--------|--------|--------|
| MCP Tools | 16 | 16 (filterable) |
| Workflow Prompts | 14 | 14 |
| MCP Resources | 13 | 13 |
| Token Efficiency | N/A | Up to 69% savings |

---

## 🔧 Technical Details

### New Files
- `src/tool_filtering.py` - Complete filtering logic with caching
- `tests/test_tool_filtering.py` - 100% test coverage

### Changed Files
- `src/server.py` - Integration with filtering in `handle_list_tools()` and `handle_call_tool()`
- `src/constants.py` - Actions graph color constants
- `src/handlers/resources.py` - Dark mode color improvements, compact Mermaid output

### Environment Variable
- `MEMORY_JOURNAL_MCP_TOOL_FILTER` - Comma-separated filter rules
- Processed left-to-right for precise control
- Cached at startup for performance

---

## ⬆️ Upgrade Instructions

### PyPI

```bash
pip install --upgrade memory-journal-mcp
```

### Docker

```bash
docker pull writenotenow/memory-journal-mcp:latest
```

**No configuration changes required!** All 16 tools remain enabled by default.

---

## 🔗 Links

- **Compare Changes**: https://github.com/neverinfamous/memory-journal-mcp/compare/v2.1.0...v2.2.0
- **Full Changelog**: [CHANGELOG.md](../CHANGELOG.md)
- **Wiki**: https://github.com/neverinfamous/memory-journal-mcp/wiki
- **Tool Filtering Guide**: https://github.com/neverinfamous/memory-journal-mcp/wiki/Tool-Filtering
- **Docker Hub**: https://hub.docker.com/r/writenotenow/memory-journal-mcp
- **PyPI**: https://pypi.org/project/memory-journal-mcp/

---

**Built by developers, for developers.** 🚀

