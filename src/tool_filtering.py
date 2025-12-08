"""Tool filtering for Memory Journal MCP Server.

Provides environment-based filtering to expose only a subset of tools,
useful for staying under tool limits (e.g., Windsurf's 100-tool limit).

Configuration via environment variable:
  MEMORY_JOURNAL_MCP_TOOL_FILTER  Comma-separated filter rules processed left-to-right

Filter syntax:
  -group    Disable all tools in a group (e.g., -analytics, -test)
  -tool     Disable a specific tool (e.g., -delete_entry)
  +tool     Enable a specific tool (e.g., +update_entry)

Examples:
  "-analytics,-test"                    Disable analytics and test groups
  "-admin,+update_entry"                Disable admin group but keep update_entry
  "-analytics,-test,+test_simple"       Disable groups but re-enable one tool

If not set or empty, all tools are enabled (no filtering).

Available groups: core, search, analytics, relationships, export, admin, test

MCP Config:
    {
        "mcpServers": {
            "memory-journal-mcp": {
                "command": "memory-journal-mcp",
                "env": {
                    "MEMORY_JOURNAL_MCP_TOOL_FILTER": "-analytics,-test"
                }
            }
        }
    }

"""

from __future__ import annotations

import logging
import os
import sys
from functools import lru_cache
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import mcp.types as types

logger = logging.getLogger("memory_journal_mcp")

# Tool groups - each group maps to a set of tool names
TOOL_GROUPS: dict[str, set[str]] = {
    "core": {
        "create_entry",
        "search_entries",
        "get_recent_entries",
        "get_entry_by_id",
        "list_tags",
    },
    "search": {
        "semantic_search",
        "search_by_date_range",
    },
    "analytics": {
        "get_statistics",
        "get_cross_project_insights",
    },
    "relationships": {
        "link_entries",
        "visualize_relationships",
    },
    "export": {
        "export_entries",
    },
    "admin": {
        "update_entry",
        "delete_entry",
    },
    "test": {
        "test_simple",
        "create_entry_minimal",
    },
}

# All available tools (derived from groups)
ALL_TOOLS: set[str] = set().union(*TOOL_GROUPS.values())


@lru_cache(maxsize=1)
def get_included_tools() -> frozenset[str]:
    """Determine which tools to include based on MEMORY_JOURNAL_MCP_TOOL_FILTER.

    Starts with all tools enabled, then processes filter rules left-to-right:
      -name   Disable group or tool
      +name   Enable tool (can restore after group disable)

    Returns:
        Frozen set of tool names to include. If env var not set, returns empty
        frozenset (meaning no filtering - all tools enabled).
    """
    filter_env = os.environ.get("MEMORY_JOURNAL_MCP_TOOL_FILTER", "").strip()

    if not filter_env:
        logger.debug("MEMORY_JOURNAL_MCP_TOOL_FILTER not set - all tools enabled", file=sys.stderr)
        return frozenset()

    # Start with all tools
    result: set[str] = ALL_TOOLS.copy()
    rules = [r.strip() for r in filter_env.split(",") if r.strip()]

    for rule in rules:
        if rule.startswith("-"):
            name = rule[1:]
            if name in TOOL_GROUPS:
                removed = result & TOOL_GROUPS[name]
                result -= TOOL_GROUPS[name]
                if removed:
                    logger.info(f"Disabled group '{name}': -{len(removed)} tools", file=sys.stderr)
            elif name in ALL_TOOLS:
                if name in result:
                    result.discard(name)
                    logger.info(f"Disabled tool '{name}'", file=sys.stderr)
            else:
                logger.warning(f"Unknown group/tool ignored: '{name}'", file=sys.stderr)
        elif rule.startswith("+"):
            name = rule[1:]
            if name in ALL_TOOLS:
                if name not in result:
                    result.add(name)
                    logger.info(f"Enabled tool '{name}'", file=sys.stderr)
            else:
                logger.warning(f"Unknown tool ignored: '{name}'", file=sys.stderr)
        else:
            logger.warning(f"Invalid filter rule (must start with + or -): '{rule}'", file=sys.stderr)

    logger.info(f"Tool filtering active: {len(result)}/{len(ALL_TOOLS)} tools enabled", file=sys.stderr)
    return frozenset(result)


def is_tool_enabled(name: str) -> bool:
    """Check if a tool is enabled.

    Args:
        name: Tool name to check.

    Returns:
        True if tool is enabled, False if disabled by filtering.
    """
    included = get_included_tools()
    # Empty set means no filtering (all enabled)
    if not included:
        return True
    return name in included


def filter_tools(tools: list[types.Tool]) -> list[types.Tool]:
    """Filter a list of tools based on environment configuration.

    Args:
        tools: List of MCP Tool objects to filter.

    Returns:
        Filtered list containing only enabled tools.
    """
    included = get_included_tools()
    # Empty set means no filtering
    if not included:
        return tools
    return [t for t in tools if t.name in included]


def clear_cache() -> None:
    """Clear the cached included tools. Useful for testing."""
    get_included_tools.cache_clear()


def get_available_groups() -> dict[str, set[str]]:
    """Return available tool groups for documentation/CLI purposes."""
    return TOOL_GROUPS.copy()


def get_all_tool_names() -> set[str]:
    """Return all known tool names."""
    return ALL_TOOLS.copy()
