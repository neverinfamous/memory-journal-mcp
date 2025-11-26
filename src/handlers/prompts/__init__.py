"""
Memory Journal MCP Server - MCP Prompts Handlers
Handlers for MCP prompt requests.
"""

from handlers.prompts import (
    analysis,
    discovery,
    reporting,
    pr_workflows,
    actions_workflows,
    registry
)

__all__ = [
    "analysis",
    "discovery",
    "reporting",
    "pr_workflows",
    "actions_workflows",
    "registry"
]