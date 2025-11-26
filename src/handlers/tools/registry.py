"""
Memory Journal MCP Server - MCP Tools Registry
Tool definitions and schemas for all available MCP tools.
"""

from typing import Any, Dict, List
from mcp.types import Tool


def list_tools() -> List[Tool]:
    """List all available MCP tools with their schemas."""
    return [
        Tool(
            name="create_entry",
            description="Create a new journal entry with context and tags (v2.1.0: GitHub Actions support)",
            inputSchema={
                "type": "object",
                "properties": {
                    "content": {"type": "string", "description": "The journal entry content"},
                    "is_personal": {"type": "boolean", "default": True},
                    "entry_type": {"type": "string", "default": "personal_reflection"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "significance_type": {"type": "string"},
                    "auto_context": {"type": "boolean", "default": True},
                    "share_with_team": {"type": "boolean", "default": False, "description": "Share this entry with team via Git (copies to .memory-journal-team.db)"},
                    "project_number": {"type": "integer", "description": "GitHub Project number (optional)"},
                    "project_item_id": {"type": "integer", "description": "GitHub Project item ID (optional)"},
                    "github_project_url": {"type": "string", "description": "GitHub Project URL (optional)"},
                    "project_owner": {"type": "string", "description": "GitHub Project owner (username or org name) - optional, auto-detected from context"},
                    "project_owner_type": {"type": "string", "enum": ["user", "org"], "description": "Project owner type (user or org) - optional, auto-detected"},
                    "issue_number": {"type": "integer", "description": "GitHub Issue number (optional, auto-detected from branch name)"},
                    "issue_url": {"type": "string", "description": "GitHub Issue URL (optional)"},
                    "pr_number": {"type": "integer", "description": "GitHub Pull Request number (optional, auto-detected from current branch)"},
                    "pr_url": {"type": "string", "description": "GitHub Pull Request URL (optional)"},
                    "pr_status": {"type": "string", "enum": ["draft", "open", "merged", "closed"], "description": "PR status (optional)"},
                    "workflow_run_id": {"type": "integer", "description": "GitHub Actions workflow run ID (optional)"},
                    "workflow_name": {"type": "string", "description": "GitHub Actions workflow name (optional)"},
                    "workflow_status": {"type": "string", "enum": ["queued", "in_progress", "completed"], "description": "Workflow run status (optional)"}
                },
                "required": ["content"]
            }
        ),
        Tool(
            name="search_entries",
            description="Search journal entries with optional filters for GitHub Projects, Issues, PRs, and Actions",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "is_personal": {"type": "boolean"},
                    "limit": {"type": "integer", "default": 10},
                    "project_number": {"type": "integer", "description": "Filter by GitHub Project number (optional)"},
                    "issue_number": {"type": "integer", "description": "Filter by GitHub Issue number (optional)"},
                    "pr_number": {"type": "integer", "description": "Filter by GitHub PR number (optional)"},
                    "pr_status": {"type": "string", "enum": ["draft", "open", "merged", "closed"], "description": "Filter by PR status (optional)"},
                    "workflow_run_id": {"type": "integer", "description": "Filter by GitHub Actions workflow run ID (optional)"}
                }
            }
        ),
        Tool(
            name="get_recent_entries",
            description="Get recent journal entries",
            inputSchema={
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "default": 5},
                    "is_personal": {"type": "boolean"}
                }
            }
        ),
        Tool(
            name="list_tags",
            description="List all available tags",
            inputSchema={"type": "object", "properties": {}}
        ),
        Tool(
            name="test_simple",
            description="Simple test tool that just returns a message",
            inputSchema={
                "type": "object",
                "properties": {
                    "message": {"type": "string", "default": "Hello"}
                }
            }
        ),
        Tool(
            name="create_entry_minimal",
            description="Minimal entry creation without context or tags",
            inputSchema={
                "type": "object",
                "properties": {
                    "content": {"type": "string", "description": "The journal entry content"},
                    "project_number": {"type": "integer", "description": "GitHub Project number (optional)"},
                    "project_item_id": {"type": "integer", "description": "GitHub Project item ID (optional)"},
                    "github_project_url": {"type": "string", "description": "GitHub Project URL (optional)"}
                },
                "required": ["content"]
            }
        ),
        Tool(
            name="semantic_search",
            description="Perform semantic/vector search on journal entries",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query for semantic similarity"},
                    "limit": {"type": "integer", "default": 10, "description": "Maximum number of results"},
                    "similarity_threshold": {
                        "type": "number", "default": 0.3,
                        "description": "Minimum similarity score (0.0-1.0)"
                    },
                    "is_personal": {"type": "boolean", "description": "Filter by personal entries"}
                },
                "required": ["query"]
            }
        ),
        Tool(
            name="update_entry",
            description="Update an existing journal entry",
            inputSchema={
                "type": "object",
                "properties": {
                    "entry_id": {"type": "integer", "description": "ID of the entry to update"},
                    "content": {"type": "string", "description": "New content for the entry"},
                    "entry_type": {"type": "string", "description": "Update entry type"},
                    "tags": {"type": "array", "items": {"type": "string"}, "description": "Replace tags"},
                    "is_personal": {"type": "boolean", "description": "Update personal flag"}
                },
                "required": ["entry_id"]
            }
        ),
        Tool(
            name="delete_entry",
            description="Delete a journal entry (soft delete with timestamp)",
            inputSchema={
                "type": "object",
                "properties": {
                    "entry_id": {"type": "integer", "description": "ID of the entry to delete"},
                    "permanent": {"type": "boolean", "default": False, "description": "Permanently delete (true) or soft delete (false)"}
                },
                "required": ["entry_id"]
            }
        ),
        Tool(
            name="get_entry_by_id",
            description="Get a specific journal entry by ID with full details",
            inputSchema={
                "type": "object",
                "properties": {
                    "entry_id": {"type": "integer", "description": "ID of the entry to retrieve"},
                    "include_relationships": {"type": "boolean", "default": True, "description": "Include related entries"}
                },
                "required": ["entry_id"]
            }
        ),
        Tool(
            name="link_entries",
            description="Create a relationship between two journal entries",
            inputSchema={
                "type": "object",
                "properties": {
                    "from_entry_id": {"type": "integer", "description": "Source entry ID"},
                    "to_entry_id": {"type": "integer", "description": "Target entry ID"},
                    "relationship_type": {
                        "type": "string", 
                        "description": "Type of relationship (evolves_from, references, implements, clarifies, response_to)",
                        "default": "references"
                    },
                    "description": {"type": "string", "description": "Optional description of the relationship"}
                },
                "required": ["from_entry_id", "to_entry_id"]
            }
        ),
        Tool(
            name="search_by_date_range",
            description="Search journal entries within a date range with optional filters for GitHub Projects, Issues, PRs, and Actions",
            inputSchema={
                "type": "object",
                "properties": {
                    "start_date": {"type": "string", "description": "Start date (YYYY-MM-DD)"},
                    "end_date": {"type": "string", "description": "End date (YYYY-MM-DD)"},
                    "is_personal": {"type": "boolean", "description": "Filter by personal entries"},
                    "entry_type": {"type": "string", "description": "Filter by entry type"},
                    "tags": {"type": "array", "items": {"type": "string"}, "description": "Filter by tags"},
                    "project_number": {"type": "integer", "description": "Filter by GitHub Project number (optional)"},
                    "issue_number": {"type": "integer", "description": "Filter by GitHub Issue number (optional)"},
                    "pr_number": {"type": "integer", "description": "Filter by GitHub PR number (optional)"},
                    "workflow_run_id": {"type": "integer", "description": "Filter by GitHub Actions workflow run ID (optional)"}
                },
                "required": ["start_date", "end_date"]
            }
        ),
        Tool(
            name="get_statistics",
            description="Get journal statistics and analytics (Phase 2: includes project breakdown)",
            inputSchema={
                "type": "object",
                "properties": {
                    "start_date": {"type": "string", "description": "Start date (YYYY-MM-DD, optional)"},
                    "end_date": {"type": "string", "description": "End date (YYYY-MM-DD, optional)"},
                    "group_by": {
                        "type": "string", 
                        "description": "Group statistics by period (day, week, month)",
                        "default": "week"
                    },
                    "project_breakdown": {
                        "type": "boolean",
                        "description": "Include breakdown by GitHub Project number (Phase 2)",
                        "default": False
                    }
                }
            }
        ),
        Tool(
            name="export_entries",
            description="Export journal entries to JSON or Markdown format",
            inputSchema={
                "type": "object",
                "properties": {
                    "format": {
                        "type": "string", 
                        "description": "Export format (json or markdown)",
                        "default": "json"
                    },
                    "start_date": {"type": "string", "description": "Start date (YYYY-MM-DD, optional)"},
                    "end_date": {"type": "string", "description": "End date (YYYY-MM-DD, optional)"},
                    "tags": {"type": "array", "items": {"type": "string"}, "description": "Filter by tags"},
                    "entry_types": {"type": "array", "items": {"type": "string"}, "description": "Filter by entry types"}
                }
            }
        ),
        Tool(
            name="visualize_relationships",
            description="Generate a Mermaid diagram visualization of entry relationships",
            inputSchema={
                "type": "object",
                "properties": {
                    "entry_id": {"type": "integer", "description": "Specific entry ID to visualize (shows connected entries)"},
                    "tags": {"type": "array", "items": {"type": "string"}, "description": "Filter entries by tags"},
                    "depth": {
                        "type": "integer", 
                        "description": "Relationship traversal depth (1-3)",
                        "default": 2,
                        "minimum": 1,
                        "maximum": 3
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of entries to include",
                        "default": 20
                    }
                }
            }
        ),
        Tool(
            name="get_cross_project_insights",
            description="Analyze patterns across all GitHub Projects tracked in journal entries (Phase 2)",
            inputSchema={
                "type": "object",
                "properties": {
                    "start_date": {"type": "string", "description": "Start date (YYYY-MM-DD, optional)"},
                    "end_date": {"type": "string", "description": "End date (YYYY-MM-DD, optional)"},
                    "min_entries": {
                        "type": "integer",
                        "description": "Minimum entries to include project",
                        "default": 3
                    }
                }
            }
        )
    ]


async def call_tool(name: str, arguments: Dict[str, Any]):
    """
    Main dispatcher for tool calls.
    Routes tool calls to the appropriate handler based on tool name.
    """
    import mcp.types as types
    
    # Import handler modules
    from handlers.tools import entries, search, analytics, relationships, export
    
    # Entry management tools
    if name == "create_entry":
        return await entries.handle_create_entry(arguments)
    elif name == "update_entry":
        return await entries.handle_update_entry(arguments)
    elif name == "delete_entry":
        return await entries.handle_delete_entry(arguments)
    elif name == "get_entry_by_id":
        return await entries.handle_get_entry_by_id(arguments)
    
    # Search tools
    elif name == "search_entries":
        return await search.handle_search_entries(arguments)
    elif name == "semantic_search":
        return await search.handle_semantic_search(arguments)
    elif name == "search_by_date_range":
        return await search.handle_search_by_date_range(arguments)
    elif name == "get_recent_entries":
        return await entries.handle_get_recent_entries(arguments)
    elif name == "list_tags":
        return await entries.handle_list_tags(arguments)
    
    # Analytics tools
    elif name == "get_statistics":
        return await analytics.handle_get_statistics(arguments)
    elif name == "get_cross_project_insights":
        return await analytics.handle_get_cross_project_insights(arguments)
    
    # Relationship tools
    elif name == "link_entries":
        return await relationships.handle_link_entries(arguments)
    elif name == "visualize_relationships":
        return await relationships.handle_visualize_relationships(arguments)
    
    # Export tools
    elif name == "export_entries":
        return await export.handle_export_entries(arguments)
    
    # Test tools
    elif name == "test_simple":
        message = arguments.get("message", "Hello")
        return [types.TextContent(
            type="text",
            text=f"✅ Simple test successful! Message: {message}"
        )]
    elif name == "create_entry_minimal":
        return await entries.handle_create_entry(arguments)  # Use same handler
    
    else:
        return [types.TextContent(
            type="text",
            text=f"❌ Unknown tool: {name}"
        )]
