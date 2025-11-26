"""
MCP prompt handlers for reporting and project status tracking.
Provides GitHub Project status summaries and milestone tracking prompts.
"""

import asyncio
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from mcp.types import GetPromptResult, PromptMessage, TextContent
from concurrent.futures import ThreadPoolExecutor

from database.base import MemoryJournalDB
from database.context import ProjectContextManager
from github.integration import GitHubProjectsIntegration

# These will be initialized by the main server
db: Optional[MemoryJournalDB] = None
project_context_manager: Optional[ProjectContextManager] = None
github_projects: Optional[GitHubProjectsIntegration] = None
thread_pool: Optional[ThreadPoolExecutor] = None

def initialize_reporting_prompts(db_instance: MemoryJournalDB, 
                                 project_context_manager_instance: ProjectContextManager,
                                 github_projects_instance: GitHubProjectsIntegration,
                                 thread_pool_instance: ThreadPoolExecutor):
    """Initialize reporting prompt handlers with required dependencies."""
    global db, project_context_manager, github_projects, thread_pool
    db = db_instance
    project_context_manager = project_context_manager_instance
    github_projects = github_projects_instance
    thread_pool = thread_pool_instance


async def handle_project_status_summary(arguments: Dict[str, str]) -> GetPromptResult:
    """
    Handle project-status-summary prompt.
    Generate comprehensive GitHub Project status report (Phase 2 & 3: org support).
    Now accepts project_name instead of project_number for consistency with other prompts.
    """
    project_name = arguments.get("project_name")
    time_period = arguments.get("time_period", "week")
    include_items = arguments.get("include_items", "true")
    owner = arguments.get("owner")
    _owner_type = arguments.get("owner_type")  # Reserved for future use
    if db is None or project_context_manager is None or github_projects is None or thread_pool is None:
        raise RuntimeError("Reporting prompt handlers not initialized.")

    # Capture for use in nested functions
    _db = db
    _pcm = project_context_manager
    _github_projects = github_projects
    
    include_items_bool = include_items.lower() == "true"

    # Calculate date range based on time period
    end_date = datetime.now()
    if time_period == "month":
        start_date = end_date - timedelta(days=30)
    elif time_period == "sprint":
        start_date = end_date - timedelta(days=14)
    else:  # week
        start_date = end_date - timedelta(days=7)

    start_str = start_date.strftime('%Y-%m-%d')
    end_str = end_date.strftime('%Y-%m-%d')

    def get_project_data() -> tuple[list[Dict[str, Any]], Dict[str, Any]]:
        """Get journal entries and statistics for the project."""
        import json
        with _db.get_connection() as conn:
            # Get all entries in the date range
            cursor = conn.execute("""
                SELECT id, entry_type, content, timestamp, project_context
                FROM memory_journal
                WHERE deleted_at IS NULL
                  AND DATE(timestamp) >= DATE(?) AND DATE(timestamp) <= DATE(?)
                ORDER BY timestamp DESC
            """, (start_str, end_str))
            all_entries: list[Dict[str, Any]] = [dict(row) for row in cursor.fetchall()]
            
            # Filter by project name if specified
            entries: list[Dict[str, Any]] = []
            for entry in all_entries:
                if project_name and entry.get('project_context'):
                    try:
                        ctx = json.loads(entry['project_context'])
                        if ctx.get('repo_name', '').lower() == project_name.lower():
                            entries.append(entry)
                    except:
                        pass
                elif not project_name:
                    # Include all entries if no project filter
                    entries.append(entry)

            # Get project statistics (all time)
            if project_name:
                # Filter stats by project name
                cursor = conn.execute("""
                    SELECT id, timestamp, project_context
                    FROM memory_journal
                    WHERE deleted_at IS NULL
                """)
                all_stat_entries = [dict(row) for row in cursor.fetchall()]
                
                stat_entries: list[Dict[str, Any]] = []
                for entry in all_stat_entries:
                    if entry.get('project_context'):
                        try:
                            ctx = json.loads(entry['project_context'])
                            if ctx.get('repo_name', '').lower() == project_name.lower():
                                stat_entries.append(entry)
                        except:
                            pass
                
                total = len(stat_entries)
                active_days = len(set(str(e['timestamp'])[:10] for e in stat_entries))
                first_entry = min((str(e['timestamp']) for e in stat_entries), default=None)
                last_entry = max((str(e['timestamp']) for e in stat_entries), default=None)
            else:
                cursor = conn.execute("""
                    SELECT COUNT(*) as total,
                           COUNT(DISTINCT DATE(timestamp)) as active_days,
                           MIN(timestamp) as first_entry,
                           MAX(timestamp) as last_entry
                    FROM memory_journal
                    WHERE deleted_at IS NULL
                """)
                row = cursor.fetchone()
                total = row[0]
                active_days = row[1]
                first_entry = row[2]
                last_entry = row[3]
            
            stats = {
                'total': total,
                'active_days': active_days,
                'first_entry': first_entry,
                'last_entry': last_entry
            }

            return entries, stats

    loop = asyncio.get_event_loop()
    entries, stats = await loop.run_in_executor(thread_pool, get_project_data)

    # Get project details and items from GitHub (Phase 3: use owner params if provided)
    project_context = await _pcm.get_project_context()
    owner_resolved = owner
    repo = project_name  # Use project_name if provided
    
    # Auto-detect owner and repo from context if not provided
    if not owner_resolved and 'repo_path' in project_context:
        owner_resolved = _github_projects.extract_repo_owner_from_remote(project_context['repo_path'])
        if owner_resolved:
            _owner_type_resolved = _github_projects.detect_owner_type(owner_resolved)  # Reserved for future use
    
    if not repo and 'repo_name' in project_context:
        repo = project_context['repo_name']

    # Note: GitHub Project board items are not included in this report when using project_name
    # This prompt now focuses on journal entries and repository context
    project_details = None
    project_items: List[Dict[str, Any]] = []

    # Format output
    project_label = f"Project: {project_name}" if project_name else "All Projects"
    summary = f"# 📊 {project_label} Status Summary\n\n"
    summary += f"**Period:** {start_str} to {end_str} ({time_period})\n"
    summary += f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n"

    # Project overview
    if project_details:
        summary += f"## Project Overview\n"
        summary += f"**Name:** {project_details.get('name', 'Unknown')}\n"
        if project_details.get('description'):
            summary += f"**Description:** {project_details['description']}\n"
        summary += f"**Status:** {project_details.get('state', 'unknown')}\n"
        summary += f"**URL:** {project_details.get('url', 'N/A')}\n\n"

    # Journal statistics
    summary += f"## Journal Activity\n"
    summary += f"**Total Entries:** {len(entries)}\n"
    summary += f"**Active Days:** {stats.get('active_days', 0)}\n"
    if stats.get('first_entry'):
        summary += f"**First Entry:** {stats['first_entry']}\n"
    if stats.get('last_entry'):
        summary += f"**Last Entry:** {stats['last_entry']}\n"
    summary += "\n"

    # Recent journal entries
    if entries:
        summary += f"## Recent Entries\n"
        for entry in entries[:10]:
            preview = entry['content'][:150] + ('...' if len(entry['content']) > 150 else '')
            summary += f"- **#{entry['id']}** ({entry['entry_type']}) - {entry['timestamp'][:10]}\n"
            summary += f"  {preview}\n\n"

    # Group project items by status (initialize early to avoid unbound variable)
    by_status: Dict[str, List[Dict[str, Any]]] = {}
    
    # Project items status
    if include_items_bool and project_items:
        summary += f"## Project Items ({len(project_items)} total)\n"
        
        for item in project_items:
            status = item.get('status', 'unknown')
            if status not in by_status:
                by_status[status] = []
            by_status[status].append(item)
        
        for status, items in by_status.items():
            summary += f"\n### {status.capitalize()} ({len(items)})\n"
            for item in items[:5]:
                title = item.get('title', 'Untitled')
                summary += f"- {title}\n"

    # Key insights
    summary += f"\n## Key Insights\n"
    if len(entries) > 0:
        active_days = stats.get('active_days') or 1
        avg_per_day = len(entries) / max(active_days, 1)
        summary += f"- Average entries per active day: {avg_per_day:.1f}\n"
    
    if include_items_bool and project_items:
        completed = len(by_status.get('done', [])) + len(by_status.get('completed', []))
        total_items = len(project_items)
        if total_items > 0:
            completion_rate = (completed / total_items) * 100
            summary += f"- Project completion rate: {completion_rate:.1f}%\n"

    description = f"Status summary for {project_name}" if project_name else "Status summary for all projects"
    return GetPromptResult(
        description=description,
        messages=[PromptMessage(
            role="user",
            content=TextContent(type="text", text=summary)
        )]
    )


async def handle_project_milestone_tracker(arguments: Dict[str, str]) -> GetPromptResult:
    """
    Handle project-milestone-tracker prompt.
    Track GitHub Project milestones with velocity analysis (Phase 2 & 3: org support).
    Now accepts project_name instead of project_number for consistency with goal-tracker.
    """
    project_name = arguments.get("project_name")
    milestone_name = arguments.get("milestone_name")
    owner = arguments.get("owner")
    _owner_type = arguments.get("owner_type")  # Reserved for future use
    if db is None or project_context_manager is None or github_projects is None or thread_pool is None:
        raise RuntimeError("Reporting prompt handlers not initialized.")

    # Capture for use in nested functions
    _db = db
    _pcm = project_context_manager
    _github_projects = github_projects
    
    def get_milestone_data() -> tuple[list[Dict[str, Any]], list[Dict[str, Any]]]:
        """Get journal entries and velocity data for the project."""
        import json
        with _db.get_connection() as conn:
            # Build query to get entries, optionally filtering by project_name
            sql = """
                SELECT id, entry_type, content, timestamp, project_context,
                       strftime('%Y-W%W', timestamp) as week
                FROM memory_journal
                WHERE deleted_at IS NULL
            """
            # Note: params reserved for future SQL filtering, currently filtering in Python
            
            # If project_name provided, we'll filter in Python since project_context is JSON
            cursor = conn.execute(sql + " ORDER BY timestamp DESC")
            all_entries: list[Dict[str, Any]] = [dict(row) for row in cursor.fetchall()]
            
            # Filter by project name if specified
            entries: list[Dict[str, Any]] = []
            for entry in all_entries:
                if project_name and entry.get('project_context'):
                    try:
                        ctx = json.loads(entry['project_context'])
                        if ctx.get('repo_name', '').lower() == project_name.lower():
                            entries.append(entry)
                    except:
                        pass
                elif not project_name:
                    # Include all entries if no project filter
                    entries.append(entry)

            # Calculate velocity from filtered entries
            velocity_map: Dict[str, int] = {}
            for entry in entries:
                week = str(entry['week'])
                velocity_map[week] = velocity_map.get(week, 0) + 1
            
            velocity = [{'week': week, 'count': count} 
                       for week, count in sorted(velocity_map.items(), reverse=True)[:12]]

            return entries, velocity

    loop = asyncio.get_event_loop()
    entries, velocity = await loop.run_in_executor(thread_pool, get_milestone_data)

    # Get GitHub milestones (Phase 3: use owner params if provided)
    project_context = await _pcm.get_project_context()
    owner_resolved = owner
    repo = project_name  # Use project_name if provided
    
    # Auto-detect owner and repo from context if not provided
    if not owner_resolved and 'repo_path' in project_context:
        owner_resolved = _github_projects.extract_repo_owner_from_remote(project_context['repo_path'])
    
    if not repo and 'repo_name' in project_context:
        repo = project_context['repo_name']

    milestones: List[Dict[str, Any]] = []
    if owner_resolved and repo and _github_projects.api_manager:
        api_manager = _github_projects.api_manager
        if hasattr(api_manager, 'get_repo_milestones'):
            milestones = api_manager.get_repo_milestones(owner_resolved, repo)
        if milestone_name:
            milestones = [m for m in milestones if milestone_name.lower() in m.get('title', '').lower()]

    # Format output
    project_label = f"Project: {project_name}" if project_name else "All Projects"
    tracker = f"# 🎯 Milestone Tracker - {project_label}\n\n"
    
    if milestones:
        tracker += f"## GitHub Milestones\n"
        for milestone in milestones:
            tracker += f"\n### {milestone['title']}\n"
            if milestone.get('description'):
                tracker += f"{milestone['description']}\n\n"
            tracker += f"**Status:** {milestone['state']}\n"
            tracker += f"**Progress:** {milestone['closed_issues']}/{milestone['open_issues'] + milestone['closed_issues']} issues closed\n"
            if milestone.get('due_on'):
                tracker += f"**Due:** {milestone['due_on'][:10]}\n"
            tracker += f"**URL:** {milestone['url']}\n"
    else:
        tracker += f"No GitHub milestones found for this project.\n\n"

    # Journal entries summary
    tracker += f"\n## Journal Activity\n"
    tracker += f"**Total Entries:** {len(entries)}\n"
    if entries:
        tracker += f"**Date Range:** {entries[-1]['timestamp'][:10]} to {entries[0]['timestamp'][:10]}\n"
    tracker += "\n"

    # Velocity tracking
    if velocity:
        tracker += f"## Velocity (Last 12 Weeks)\n"
        total_weeks = len(velocity)
        total_entries = sum(v['count'] for v in velocity)
        avg_velocity = total_entries / total_weeks if total_weeks > 0 else 0
        tracker += f"**Average:** {avg_velocity:.1f} entries/week\n\n"
        
        tracker += "```\n"
        for v in velocity[:8]:
            bar = '█' * min(v['count'], 50)
            tracker += f"{v['week']}: {bar} ({v['count']})\n"
        tracker += "```\n\n"

    # Timeline suggestion (only show if we have a specific project context)
    if project_name or repo:
        tracker += f"## 💡 Tip\n"
        tracker += f"To see GitHub milestones, make sure you're in the repository directory or provide the project owner/repo details.\n"

    description = f"Milestone tracker for {project_name}" if project_name else "Milestone tracker for all projects"
    return GetPromptResult(
        description=description,
        messages=[PromptMessage(
            role="user",
            content=TextContent(type="text", text=tracker)
        )]
    )

