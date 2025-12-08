#!/usr/bin/env python3
"""
Memory Journal MCP Server
A Model Context Protocol server for personal journaling with context awareness.

This is the main entry point that wires together all the modular components.
"""

import asyncio
import sys
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, Optional

# Change to the project root directory (parent of src/)
# This ensures Git operations work correctly regardless of where MCP server starts
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(project_root)
print(f"[INFO] Changed working directory to: {project_root}", file=sys.stderr)

# Add the src directory to the path so we can import our modules
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mcp.server import Server, NotificationOptions, InitializationOptions
import mcp.server.stdio

# Import our modular components
from constants import DB_PATH, THREAD_POOL_MAX_WORKERS
from database.base import MemoryJournalDB
from database.context import ProjectContextManager
from vector_search import VectorSearchManager, VECTOR_SEARCH_AVAILABLE
from github.integration import GitHubProjectsIntegration
from tool_filtering import filter_tools, is_tool_enabled

# Import MCP handlers (they will register themselves with the server)
import handlers.resources as resources
from handlers.tools import (
    registry as tools_registry,
    entries as tools_entries,
    search as tools_search,
    analytics as tools_analytics,
    relationships as tools_relationships,
    export as tools_export
)
from handlers.prompts import (
    registry as prompts_registry,
    analysis as prompts_analysis,
    discovery as prompts_discovery,
    reporting as prompts_reporting,
    pr_workflows as prompts_pr_workflows,
    actions_workflows as prompts_actions_workflows
)

# Initialize the MCP server
server = Server("memory-journal-mcp")

# Global instances (initialized in main())
db: Optional[MemoryJournalDB] = None
project_context_manager: Optional[ProjectContextManager] = None
vector_search: Optional[VectorSearchManager] = None
github_projects: Optional[GitHubProjectsIntegration] = None
thread_pool: Optional[ThreadPoolExecutor] = None


def initialize_components():
    """Initialize all components and wire up dependencies."""
    global db, project_context_manager, vector_search
    global github_projects, thread_pool
    
    print("[INFO] Initializing Memory Journal MCP Server...", file=sys.stderr)
    
    # Initialize thread pool
    thread_pool = ThreadPoolExecutor(max_workers=THREAD_POOL_MAX_WORKERS)
    print(f"[INFO] Thread pool initialized with {THREAD_POOL_MAX_WORKERS} workers", file=sys.stderr)
    
    # Initialize database
    db = MemoryJournalDB(DB_PATH)
    print(f"[INFO] Database initialized at {DB_PATH}", file=sys.stderr)
    
    # Initialize GitHub integration
    github_projects = GitHubProjectsIntegration(db_connection=db)
    print("[INFO] GitHub integration initialized", file=sys.stderr)
    
    # Initialize project context manager
    project_context_manager = ProjectContextManager(github_projects)
    print("[INFO] Project context manager initialized", file=sys.stderr)
    
    # Initialize vector search (if available)
    if VECTOR_SEARCH_AVAILABLE:
        vector_search = VectorSearchManager(db_path=DB_PATH)
        print("[INFO] Vector search manager initialized (lazy loading)", file=sys.stderr)
    else:
        vector_search = None
        print("[WARNING] Vector search unavailable - install sentence-transformers and faiss-cpu", file=sys.stderr)
    
    # Initialize MCP resource handlers
    resources.initialize_resource_handlers(db, github_projects, project_context_manager)
    print("[INFO] MCP resource handlers initialized", file=sys.stderr)
    
    # Initialize MCP tool handlers
    tools_entries.initialize_entry_handlers(db, project_context_manager, vector_search, thread_pool)
    tools_search.initialize_search_handlers(db, vector_search, thread_pool)
    tools_analytics.initialize_analytics_handlers(db, thread_pool)
    tools_relationships.initialize_relationship_handlers(db, thread_pool)
    tools_export.initialize_export_handlers(db, thread_pool)
    print("[INFO] MCP tool handlers initialized", file=sys.stderr)
    
    # Initialize MCP prompt handlers
    prompts_analysis.initialize_analysis_prompts(db, project_context_manager, thread_pool)
    prompts_discovery.initialize_discovery_prompts(db, vector_search, thread_pool)
    prompts_reporting.initialize_reporting_prompts(db, project_context_manager, github_projects, thread_pool)
    prompts_pr_workflows.initialize_pr_prompts(db, project_context_manager, github_projects, thread_pool)
    prompts_actions_workflows.initialize_actions_prompts(db, project_context_manager, github_projects, vector_search, thread_pool)
    print("[INFO] MCP prompt handlers initialized (including PR workflows and Actions digest)", file=sys.stderr)
    
    print("[SUCCESS] Memory Journal MCP Server ready!", file=sys.stderr)


# Register MCP handlers with the server
@server.list_resources()
async def handle_list_resources():
    """List available resources."""
    return await resources.list_resources()


@server.read_resource()
async def handle_read_resource(uri: Any) -> str:
    """Read a specific resource."""
    return await resources.read_resource(uri)


@server.list_tools()
async def handle_list_tools():
    """List available tools."""
    tools = tools_registry.list_tools()
    return filter_tools(tools)


@server.call_tool()
async def handle_call_tool(name: str, arguments: Dict[str, Any]) -> Any:
    """Handle tool calls."""
    if not is_tool_enabled(name):
        import mcp.types as types
        return [types.TextContent(
            type="text",
            text=f"Tool '{name}' is disabled by filtering configuration"
        )]
    return await tools_registry.call_tool(name, arguments)


@server.list_prompts()
async def handle_list_prompts():
    """List available prompts."""
    return prompts_registry.list_prompts()


@server.get_prompt()
async def handle_get_prompt(name: str, arguments: dict[str, str] | None):
    """Get a specific prompt."""
    return await prompts_registry.get_prompt(name, arguments or {})


async def main():
    """Run the server."""
    # Initialize all components
    initialize_components()
    
    # Start the MCP server
    async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            InitializationOptions(
                server_name="memory-journal",
                server_version="2.2.0",  # Tool filtering, token efficiency, dark mode improvements
                capabilities=server.get_capabilities(
                    notification_options=NotificationOptions(),
                    experimental_capabilities={},
                ),
            ),
        )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[INFO] Server shutdown requested", file=sys.stderr)
    except Exception as e:
        print(f"\n[ERROR] Server crashed: {e}", file=sys.stderr)
        sys.exit(1)

