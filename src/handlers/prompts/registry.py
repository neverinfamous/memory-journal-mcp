"""
Memory Journal MCP Server - MCP Prompts Registry
Prompt definitions for all available MCP prompts and main dispatcher.
"""

from typing import List, Dict, Optional
from mcp.server import Server
from mcp.types import Prompt, PromptArgument
import mcp.types as types

# Import handler modules
from handlers.prompts import analysis, discovery, reporting, pr_workflows, actions_workflows


def list_prompts() -> List[Prompt]:
    """List all available MCP prompts with their schemas."""
    return [
        Prompt(
            name="get-context-bundle",
            description="Get current project context as JSON",
            arguments=[
                PromptArgument(
                    name="include_git",
                    description="Include Git repository information",
                    required=False
                )
            ]
        ),
        Prompt(
            name="get-recent-entries",
            description="Get the last X journal entries",
            arguments=[
                PromptArgument(
                    name="count",
                    description="Number of recent entries to retrieve (default: 5)",
                    required=False
                ),
                PromptArgument(
                    name="personal_only",
                    description="Only show personal entries (true/false)",
                    required=False
                )
            ]
        ),
        Prompt(
            name="analyze-period",
            description="Analyze journal entries over a specific time period for insights, patterns, and achievements",
            arguments=[
                PromptArgument(
                    name="start_date",
                    description="Start date for analysis (YYYY-MM-DD)",
                    required=True
                ),
                PromptArgument(
                    name="end_date",
                    description="End date for analysis (YYYY-MM-DD)",
                    required=True
                ),
                PromptArgument(
                    name="focus_area",
                    description="Optional focus area (e.g., 'technical', 'personal', 'productivity')",
                    required=False
                )
            ]
        ),
        Prompt(
            name="prepare-standup",
            description="Prepare daily standup summary from recent technical journal entries",
            arguments=[
                PromptArgument(
                    name="days_back",
                    description="Number of days to look back (default: 1)",
                    required=False
                )
            ]
        ),
        Prompt(
            name="prepare-retro",
            description="Prepare sprint retrospective with achievements, learnings, and areas for improvement",
            arguments=[
                PromptArgument(
                    name="sprint_start",
                    description="Sprint start date (YYYY-MM-DD)",
                    required=True
                ),
                PromptArgument(
                    name="sprint_end",
                    description="Sprint end date (YYYY-MM-DD)",
                    required=True
                )
            ]
        ),
        Prompt(
            name="find-related",
            description="Find entries related to a specific entry using semantic similarity and tags",
            arguments=[
                PromptArgument(
                    name="entry_id",
                    description="Entry ID to find related entries for",
                    required=True
                ),
                PromptArgument(
                    name="similarity_threshold",
                    description="Minimum similarity score (0.0-1.0, default: 0.3)",
                    required=False
                )
            ]
        ),
        Prompt(
            name="weekly-digest",
            description="Generate a formatted summary of journal entries for a specific week",
            arguments=[
                PromptArgument(
                    name="week_offset",
                    description="Week offset (0 = current week, -1 = last week, etc.)",
                    required=False
                )
            ]
        ),
        Prompt(
            name="goal-tracker",
            description="Track progress on goals and milestones from journal entries",
            arguments=[
                PromptArgument(
                    name="project_name",
                    description="Optional project name to filter by",
                    required=False
                ),
                PromptArgument(
                    name="goal_type",
                    description="Type of goal (milestone, technical_breakthrough, etc.)",
                    required=False
                )
            ]
        ),
        Prompt(
            name="project-status-summary",
            description="Generate comprehensive GitHub Project status report (Phase 2 & 3: org support)",
            arguments=[
                PromptArgument(
                    name="project_name",
                    description="Project/repository name to filter by (e.g., 'memory-journal-mcp')",
                    required=False
                ),
                PromptArgument(
                    name="time_period",
                    description="Time period (week, sprint, month, default: week)",
                    required=False
                ),
                PromptArgument(
                    name="include_items",
                    description="Include project item status (true/false, default: true)",
                    required=False
                ),
                PromptArgument(
                    name="owner",
                    description="Phase 3: Project owner (username or org name) - optional, auto-detected from context",
                    required=False
                ),
                PromptArgument(
                    name="owner_type",
                    description="Phase 3: Project owner type (user or org) - optional, auto-detected",
                    required=False
                )
            ]
        ),
        Prompt(
            name="project-milestone-tracker",
            description="Track GitHub Project milestones with velocity analysis (Phase 2 & 3: org support)",
            arguments=[
                PromptArgument(
                    name="project_name",
                    description="Project/repository name to filter by (e.g., 'R2-Manager-Worker')",
                    required=False
                ),
                PromptArgument(
                    name="milestone_name",
                    description="Optional milestone name to filter by",
                    required=False
                ),
                PromptArgument(
                    name="owner",
                    description="Phase 3: Project owner (username or org name) - optional, auto-detected from context",
                    required=False
                ),
                PromptArgument(
                    name="owner_type",
                    description="Phase 3: Project owner type (user or org) - optional, auto-detected",
                    required=False
                )
            ]
        ),
        Prompt(
            name="pr-summary",
            description="Generate comprehensive summary of journal activity for a specific Pull Request (Phase 3)",
            arguments=[
                PromptArgument(
                    name="pr_number",
                    description="PR number to summarize",
                    required=True
                ),
                PromptArgument(
                    name="include_commits",
                    description="Include commit details (true/false, default: false)",
                    required=False
                )
            ]
        ),
        Prompt(
            name="code-review-prep",
            description="Prepare for code review by gathering PR context, linked issues, and related journal entries (Phase 3)",
            arguments=[
                PromptArgument(
                    name="pr_number",
                    description="PR number to review",
                    required=True
                ),
                PromptArgument(
                    name="author",
                    description="Optional PR author username",
                    required=False
                )
            ]
        ),
        Prompt(
            name="pr-retrospective",
            description="Analyze completed PR for learnings, metrics, and insights from journal entries (Phase 3)",
            arguments=[
                PromptArgument(
                    name="pr_number",
                    description="Completed PR number",
                    required=True
                ),
                PromptArgument(
                    name="include_metrics",
                    description="Include time metrics (true/false, default: true)",
                    required=False
                )
            ]
        ),
        Prompt(
            name="actions-failure-digest",
            description="Comprehensive digest of GitHub Actions failures with root cause analysis and recommendations",
            arguments=[
                PromptArgument(
                    name="branch",
                    description="Filter failures to specific branch",
                    required=False
                ),
                PromptArgument(
                    name="workflow_name",
                    description="Filter by workflow name",
                    required=False
                ),
                PromptArgument(
                    name="pr_number",
                    description="Filter by associated PR number",
                    required=False
                ),
                PromptArgument(
                    name="days_back",
                    description="How far back to look (default: 7)",
                    required=False
                ),
                PromptArgument(
                    name="limit",
                    description="Maximum failures to analyze (default: 5)",
                    required=False
                )
            ]
        )
    ]


@Server("memory-journal-mcp").list_prompts()
async def list_prompts_handler() -> List[Prompt]:
    """MCP handler for listing prompts."""
    return list_prompts()


@Server("memory-journal-mcp").get_prompt()
async def get_prompt(name: str, arguments: Optional[Dict[str, str]] = None) -> types.GetPromptResult:
    """Main prompt dispatcher - routes to appropriate handler based on name."""
    
    # Ensure arguments is not None
    if arguments is None:
        arguments = {}
    
    # Analysis prompts
    if name == "get-context-bundle":
        return await analysis.handle_get_context_bundle(arguments)
    elif name == "get-recent-entries":
        return await analysis.handle_get_recent_entries(arguments)
    elif name == "analyze-period":
        return await analysis.handle_analyze_period(arguments)
    elif name == "prepare-standup":
        return await analysis.handle_prepare_standup(arguments)
    elif name == "prepare-retro":
        return await analysis.handle_prepare_retro(arguments)
    
    # Discovery prompts
    elif name == "find-related":
        return await discovery.handle_find_related(arguments)
    elif name == "weekly-digest":
        return await discovery.handle_weekly_digest(arguments)
    elif name == "goal-tracker":
        return await discovery.handle_goal_tracker(arguments)
    
    # Reporting prompts
    elif name == "project-status-summary":
        return await reporting.handle_project_status_summary(arguments)
    elif name == "project-milestone-tracker":
        return await reporting.handle_project_milestone_tracker(arguments)
    
    # PR Workflow prompts (Phase 3)
    elif name == "pr-summary":
        return await pr_workflows.handle_pr_summary(arguments)
    elif name == "code-review-prep":
        return await pr_workflows.handle_code_review_prep(arguments)
    elif name == "pr-retrospective":
        return await pr_workflows.handle_pr_retrospective(arguments)
    
    # GitHub Actions Workflow prompts
    elif name == "actions-failure-digest":
        return await actions_workflows.handle_actions_failure_digest(arguments)
    
    else:
        raise ValueError(f"Unknown prompt: {name}")

