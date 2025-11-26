"""
Memory Journal MCP Server - Discovery Prompt Handlers
Handlers for finding related entries, weekly digests, and goal tracking.
"""

import asyncio
import json
from typing import Any, Dict, Optional
from concurrent.futures import ThreadPoolExecutor

import mcp.types as types
from mcp.types import PromptMessage

from database.base import MemoryJournalDB
from vector_search import VectorSearchManager

# These will be initialized by the main server
db: Optional[MemoryJournalDB] = None
vector_search: Optional[VectorSearchManager] = None
thread_pool: Optional[ThreadPoolExecutor] = None


def initialize_discovery_prompts(db_instance: MemoryJournalDB, 
                                  vector_search_instance: Optional[VectorSearchManager],
                                  thread_pool_instance: ThreadPoolExecutor):
    """Initialize the discovery prompt handlers with database and vector search instances."""
    global db, vector_search, thread_pool
    db = db_instance
    vector_search = vector_search_instance
    thread_pool = thread_pool_instance


async def handle_find_related(arguments: Dict[str, str]) -> types.GetPromptResult:
    """Handle find-related prompt for discovering related entries."""
    if db is None:
        raise RuntimeError("Discovery prompts not initialized.")
    
    # Capture for use in nested functions
    _db = db
    
    entry_id_str = arguments.get("entry_id")
    similarity_threshold = float(arguments.get("similarity_threshold", "0.3"))

    if not entry_id_str:
        return types.GetPromptResult(
            description="Error",
            messages=[
                PromptMessage(
                    role="user",
                    content=types.TextContent(type="text", text="❌ Entry ID is required")
                )
            ]
        )

    try:
        entry_id = int(entry_id_str)
    except ValueError:
        return types.GetPromptResult(
            description="Error",
            messages=[
                PromptMessage(
                    role="user",
                    content=types.TextContent(type="text", text="❌ Entry ID must be a number")
                )
            ]
        )

    def get_entry_and_tags() -> tuple[Dict[str, Any] | None, list[str], list[Dict[str, Any]]]:
        with _db.get_connection() as conn:
            # Get the entry
            cursor = conn.execute("""
                SELECT id, content, entry_type
                FROM memory_journal
                WHERE id = ? AND deleted_at IS NULL
            """, (entry_id,))
            entry = cursor.fetchone()
            
            if not entry:
                return None, [], []
            
            # Get entry tags
            cursor = conn.execute("""
                SELECT t.name FROM tags t
                JOIN entry_tags et ON t.id = et.tag_id
                WHERE et.entry_id = ?
            """, (entry_id,))
            tags = [row[0] for row in cursor.fetchall()]
            
            # Find entries with similar tags
            if tags:
                placeholders = ','.join(['?'] * len(tags))
                cursor = conn.execute(f"""
                    SELECT DISTINCT m.id, m.content, m.entry_type, COUNT(*) as tag_matches
                    FROM memory_journal m
                    JOIN entry_tags et ON m.id = et.entry_id
                    JOIN tags t ON et.tag_id = t.id
                    WHERE t.name IN ({placeholders})
                    AND m.id != ?
                    AND m.deleted_at IS NULL
                    GROUP BY m.id
                    ORDER BY tag_matches DESC
                    LIMIT 10
                """, (*tags, entry_id))
                tag_related = [dict(row) for row in cursor.fetchall()]
            else:
                tag_related = []
            
            return dict(entry), tags, tag_related

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(thread_pool, get_entry_and_tags)
    
    if result[0] is None:
        return types.GetPromptResult(
            description="Error",
            messages=[
                PromptMessage(
                    role="user",
                    content=types.TextContent(type="text", text=f"❌ Entry #{entry_id} not found")
                )
            ]
        )

    # Unpack with type narrowing - entry is guaranteed non-None after the check above
    entry: Dict[str, Any] = result[0]
    tags = result[1]
    tag_related = result[2]

    output = f"# 🔗 Related Entries for Entry #{entry_id}\n\n"
    output += f"**Original Entry**: {entry['content'][:150]}...\n"
    output += f"**Type**: {entry['entry_type']}\n"
    if tags:
        output += f"**Tags**: {', '.join(tags)}\n"
    output += "\n---\n\n"

    # Try semantic search if available
    semantic_related = []
    if vector_search and vector_search.initialized:
        try:
            semantic_results = await vector_search.semantic_search(entry['content'], limit=10, similarity_threshold=similarity_threshold)
            if semantic_results:
                def get_semantic_entries() -> list[tuple[Dict[str, Any], float]]:
                    entry_ids = [r[0] for r in semantic_results if r[0] != entry_id]
                    if not entry_ids:
                        return []
                    with _db.get_connection() as conn:
                        placeholders = ','.join(['?'] * len(entry_ids))
                        cursor = conn.execute(f"""
                            SELECT id, content, entry_type
                            FROM memory_journal
                            WHERE id IN ({placeholders})
                        """, entry_ids)
                        entries = {row[0]: dict(row) for row in cursor.fetchall()}
                    
                    return [(entries[r[0]], r[1]) for r in semantic_results if r[0] in entries]
                
                semantic_related = await loop.run_in_executor(thread_pool, get_semantic_entries)
        except Exception:
            pass  # Semantic search is optional, gracefully skip on error

    if semantic_related:
        output += "## 🧠 Semantically Similar Entries\n"
        for entry_data, score in semantic_related[:5]:
            preview = entry_data['content'][:150] + ('...' if len(entry_data['content']) > 150 else '')
            output += f"- **Entry #{entry_data['id']}** (similarity: {score:.2f}): {preview}\n"
        output += "\n"

    if tag_related:
        output += "## 🏷️ Entries with Shared Tags\n"
        for related in tag_related[:5]:
            preview = related['content'][:150] + ('...' if len(related['content']) > 150 else '')
            output += f"- **Entry #{related['id']}** ({related['tag_matches']} shared tags): {preview}\n"
        output += "\n"

    if not semantic_related and not tag_related:
        output += "No related entries found.\n"

    return types.GetPromptResult(
        description=f"Related entries for entry #{entry_id}",
        messages=[
            PromptMessage(
                role="user",
                content=types.TextContent(type="text", text=output)
            )
        ]
    )


async def handle_weekly_digest(arguments: Dict[str, str]) -> types.GetPromptResult:
    """Handle weekly-digest prompt."""
    if db is None:
        raise RuntimeError("Discovery prompts not initialized.")
    
    # Capture for use in nested functions
    _db = db
    
    from datetime import datetime, timedelta
    
    week_offset = int(arguments.get("week_offset", "0"))
    
    # Ensure week_offset is non-negative (can't look into the future)
    if week_offset < 0:
        week_offset = 0
    
    # Calculate the date range for the week in Python for more reliable results
    today = datetime.now()
    # Get the start of the current week (Monday)
    days_since_monday = today.weekday()  # Monday = 0, Sunday = 6
    week_start = today - timedelta(days=days_since_monday)
    
    # Adjust for week offset (0 = this week, 1 = last week, 2 = 2 weeks ago, etc.)
    target_week_start = week_start - timedelta(weeks=week_offset)
    target_week_end = target_week_start + timedelta(days=7)
    
    start_str = target_week_start.strftime('%Y-%m-%d')
    end_str = target_week_end.strftime('%Y-%m-%d')
    
    def get_week_entries():
        with _db.get_connection() as conn:
            cursor = conn.execute("""
                SELECT m.id, m.entry_type, m.content, m.timestamp, m.is_personal
                FROM memory_journal m
                WHERE m.deleted_at IS NULL
                AND DATE(m.timestamp) >= DATE(?)
                AND DATE(m.timestamp) < DATE(?)
                ORDER BY m.timestamp
            """, (start_str, end_str))
            
            return [dict(row) for row in cursor.fetchall()]

    loop = asyncio.get_event_loop()
    entries = await loop.run_in_executor(thread_pool, get_week_entries)

    week_label = "This Week" if week_offset == 0 else f"{abs(week_offset)} Week(s) Ago"
    
    digest = f"# 📅 Weekly Digest: {week_label}\n\n"
    digest += f"**Week Range:** {start_str} to {end_str}\n\n"
    
    if not entries:
        digest += "No entries found for this week.\n"
    else:
        personal = [e for e in entries if e['is_personal']]
        project = [e for e in entries if not e['is_personal']]
        
        digest += f"**Summary**: {len(entries)} total entries ({len(project)} project, {len(personal)} personal)\n\n"
        
        # Group by day
        by_day: Dict[str, list[Dict[str, Any]]] = {}
        for entry in entries:
            day: str = entry['timestamp'][:10]
            if day not in by_day:
                by_day[day] = []
            by_day[day].append(entry)
        
        for day in sorted(by_day.keys()):
            day_entries = by_day[day]
            digest += f"## {day} ({len(day_entries)} entries)\n"
            for entry in day_entries:
                icon = "🔒" if entry['is_personal'] else "💼"
                preview = entry['content'][:150] + ('...' if len(entry['content']) > 150 else '')
                digest += f"- {icon} **Entry #{entry['id']}** ({entry['entry_type']}): {preview}\n"
            digest += "\n"

    return types.GetPromptResult(
        description=f"Weekly digest: {week_label}",
        messages=[
            PromptMessage(
                role="user",
                content=types.TextContent(type="text", text=digest)
            )
        ]
    )


async def handle_goal_tracker(arguments: Dict[str, str]) -> types.GetPromptResult:
    """Handle goal-tracker prompt."""
    if db is None:
        raise RuntimeError("Discovery prompts not initialized.")
    
    # Capture for use in nested functions
    _db = db
    
    project_name = arguments.get("project_name")
    goal_type = arguments.get("goal_type")

    def get_goals() -> list[Dict[str, Any]]:
        with _db.get_connection() as conn:
            sql = """
                SELECT m.id, m.entry_type, m.content, m.timestamp, m.project_context,
                       se.significance_type, se.significance_rating
                FROM memory_journal m
                LEFT JOIN significant_entries se ON m.id = se.entry_id
                WHERE m.deleted_at IS NULL
                AND (se.significance_type IS NOT NULL OR m.entry_type = 'milestone')
            """
            params: list[Any] = []
            
            if goal_type:
                sql += " AND se.significance_type = ?"
                params.append(goal_type)
            
            sql += " ORDER BY m.timestamp DESC"
            
            cursor = conn.execute(sql, params)
            goals: list[Dict[str, Any]] = []
            
            for row in cursor.fetchall():
                goal = dict(row)
                # Filter by project name if specified
                if project_name and goal['project_context']:
                    try:
                        ctx = json.loads(goal['project_context'])
                        if ctx.get('repo_name', '').lower() != project_name.lower():
                            continue
                    except:
                        pass
                goals.append(goal)
            
            return goals

    loop = asyncio.get_event_loop()
    goals = await loop.run_in_executor(thread_pool, get_goals)

    tracker = f"# 🎯 Goal Tracker\n\n"
    
    if project_name:
        tracker += f"**Project**: {project_name}\n"
    if goal_type:
        tracker += f"**Goal Type**: {goal_type}\n"
    
    tracker += f"\n**Total Milestones/Goals**: {len(goals)}\n\n"
    
    if not goals:
        tracker += "No goals or milestones found matching the criteria.\n"
    else:
        # Group by month
        by_month: Dict[str, list[Dict[str, Any]]] = {}
        for goal in goals:
            month: str = goal['timestamp'][:7]  # YYYY-MM
            if month not in by_month:
                by_month[month] = []
            by_month[month].append(goal)
        
        for month in sorted(by_month.keys(), reverse=True):
            month_goals = by_month[month]
            tracker += f"## {month} ({len(month_goals)} milestones)\n"
            for goal in month_goals:
                sig_type = goal.get('significance_type', goal['entry_type'])
                preview = goal['content'][:200] + ('...' if len(goal['content']) > 200 else '')
                
                # Get project name from context
                project = ""
                if goal['project_context']:
                    try:
                        ctx = json.loads(goal['project_context'])
                        if ctx.get('repo_name'):
                            project = f" [{ctx['repo_name']}]"
                    except:
                        pass
                
                tracker += f"- ✅ **Entry #{goal['id']}** ({sig_type}){project}: {preview}\n"
            tracker += "\n"

    return types.GetPromptResult(
        description="Goal and milestone tracker",
        messages=[
            PromptMessage(
                role="user",
                content=types.TextContent(type="text", text=tracker)
            )
        ]
    )

