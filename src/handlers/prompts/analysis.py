"""
Memory Journal MCP Server - Analysis Prompt Handlers
Handlers for context, recent entries, period analysis, standup, and retrospective prompts.
"""

import asyncio
import json
import os
from datetime import datetime
from typing import Any, Dict, Optional
from concurrent.futures import ThreadPoolExecutor

import mcp.types as types
from mcp.types import PromptMessage

from database.base import MemoryJournalDB
from database.context import ProjectContextManager

# These will be initialized by the main server
db: Optional[MemoryJournalDB] = None
project_context_manager: Optional[ProjectContextManager] = None
thread_pool: Optional[ThreadPoolExecutor] = None


def initialize_analysis_prompts(db_instance: MemoryJournalDB, 
                                 project_context_manager_instance: ProjectContextManager,
                                 thread_pool_instance: ThreadPoolExecutor):
    """Initialize the analysis prompt handlers with database instance."""
    global db, project_context_manager, thread_pool
    db = db_instance
    project_context_manager = project_context_manager_instance
    thread_pool = thread_pool_instance


async def handle_get_context_bundle(arguments: Dict[str, str]) -> types.GetPromptResult:
    """Handle get-context-bundle prompt for project context."""
    if db is None or project_context_manager is None:
        raise RuntimeError("Analysis prompts not initialized.")
    
    # Capture for use in nested functions
    _pcm = project_context_manager
    
    include_git = arguments.get("include_git", "true").lower() == "true"

    if include_git:
        # Get full context with Git info
        context = await _pcm.get_project_context()
    else:
        # Get basic context without Git operations
        context = {
            'cwd': os.getcwd(),
            'timestamp': datetime.now().isoformat(),
            'git_disabled': 'Git operations skipped by request'
        }

    context_json = json.dumps(context, indent=2)

    return types.GetPromptResult(
        description="Current project context bundle",
        messages=[
            PromptMessage(
                role="user",
                content=types.TextContent(
                    type="text",
                    text=f"Here is the current project context bundle:\n\n```json\n"
                         f"{context_json}\n```\n\nThis includes repository information, "
                         f"current working directory, and timestamp. You can use this context "
                         f"to understand the current project state when creating journal entries."
                )
            )
        ]
    )


async def handle_get_recent_entries(arguments: Dict[str, str]) -> types.GetPromptResult:
    """Handle get-recent-entries prompt."""
    if db is None:
        raise RuntimeError("Analysis prompts not initialized.")
    
    # Capture for use in nested functions
    _db = db
    
    count = int(arguments.get("count", "5"))
    personal_only = arguments.get("personal_only", "false").lower() == "true"

    # Get recent entries using existing database functionality
    def get_entries_sync() -> list[Dict[str, Any]]:
        with _db.get_connection() as conn:
            sql = "SELECT id, entry_type, content, timestamp, is_personal, project_context FROM memory_journal"
            params: list[Any] = []

            if personal_only:
                sql += " WHERE is_personal = ?"
                params.append(True)

            sql += " ORDER BY timestamp DESC LIMIT ?"
            params.append(count)

            cursor = conn.execute(sql, params)
            entries: list[Dict[str, Any]] = []
            for row in cursor.fetchall():
                entry = {
                    'id': row[0],
                    'entry_type': row[1],
                    'content': row[2],
                    'timestamp': row[3],
                    'is_personal': bool(row[4]),
                    'project_context': json.loads(row[5]) if row[5] else None
                }
                entries.append(entry)
            return entries

    # Run in thread pool
    loop = asyncio.get_event_loop()
    entries = await loop.run_in_executor(thread_pool, get_entries_sync)

    # Format entries for display
    entries_text = f"Here are the {len(entries)} most recent journal entries"
    if personal_only:
        entries_text += " (personal only)"
    entries_text += ":\n\n"

    for _i, entry in enumerate(entries, 1):
        entries_text += f"**Entry #{entry['id']}** ({entry['entry_type']}) - {entry['timestamp']}\n"
        entries_text += f"Personal: {entry['is_personal']}\n"
        entries_text += f"Content: {entry['content'][:200]}"
        if len(entry['content']) > 200:
            entries_text += "..."
        entries_text += "\n"

        if entry['project_context']:
            ctx = entry['project_context']
            if 'repo_name' in ctx:
                entries_text += f"Context: {ctx['repo_name']} ({ctx.get('branch', 'unknown branch')})\n"
        entries_text += "\n"

    return types.GetPromptResult(
        description=f"Last {count} journal entries",
        messages=[
            PromptMessage(
                role="user",
                content=types.TextContent(
                    type="text",
                    text=entries_text
                )
            )
        ]
    )


async def handle_analyze_period(arguments: Dict[str, str]) -> types.GetPromptResult:
    """Handle analyze-period prompt."""
    if db is None:
        raise RuntimeError("Analysis prompts not initialized.")
    
    # Capture for use in nested functions
    _db = db
    
    start_date = arguments.get("start_date")
    end_date = arguments.get("end_date")
    _focus_area = arguments.get("focus_area", "all")  # Reserved for future filtering

    def get_period_data():
        with _db.get_connection() as conn:
            cursor = conn.execute("""
                SELECT m.id, m.entry_type, m.content, m.timestamp, m.is_personal
                FROM memory_journal m
                WHERE m.deleted_at IS NULL
                AND DATE(m.timestamp) >= DATE(?)
                AND DATE(m.timestamp) <= DATE(?)
                ORDER BY m.timestamp
            """, (start_date, end_date))
            
            entries = [dict(row) for row in cursor.fetchall()]
            
            # Get tags for entries
            for entry in entries:
                tag_cursor = conn.execute("""
                    SELECT t.name FROM tags t
                    JOIN entry_tags et ON t.id = et.tag_id
                    WHERE et.entry_id = ?
                """, (entry['id'],))
                entry['tags'] = [t[0] for t in tag_cursor.fetchall()]
            
            # Get significant entries
            cursor = conn.execute("""
                SELECT se.entry_id, se.significance_type
                FROM significant_entries se
                JOIN memory_journal m ON se.entry_id = m.id
                WHERE DATE(m.timestamp) >= DATE(?)
                AND DATE(m.timestamp) <= DATE(?)
                AND m.deleted_at IS NULL
            """, (start_date, end_date))
            
            significant = {row[0]: row[1] for row in cursor.fetchall()}
            
            return entries, significant

    loop = asyncio.get_event_loop()
    entries, significant = await loop.run_in_executor(thread_pool, get_period_data)

    # Analyze the data
    analysis = f"# 📊 Period Analysis: {start_date} to {end_date}\n\n"
    
    if not entries:
        analysis += "No entries found for this period.\n"
    else:
        # Summary stats
        personal_count = sum(1 for e in entries if e['is_personal'])
        project_count = len(entries) - personal_count
        
        analysis += f"## Summary\n"
        analysis += f"- **Total Entries**: {len(entries)}\n"
        analysis += f"- **Personal**: {personal_count} | **Project**: {project_count}\n"
        analysis += f"- **Significant Entries**: {len(significant)}\n\n"
        
        # Entry types breakdown
        type_counts: Dict[str, int] = {}
        for e in entries:
            type_counts[e['entry_type']] = type_counts.get(e['entry_type'], 0) + 1
        
        analysis += f"## Activity Breakdown\n"
        for entry_type, count in sorted(type_counts.items(), key=lambda x: x[1], reverse=True):
            analysis += f"- {entry_type}: {count}\n"
        analysis += "\n"
        
        # Significant achievements
        if significant:
            analysis += f"## 🏆 Significant Achievements\n"
            for entry in entries:
                if entry['id'] in significant:
                    analysis += f"- **Entry #{entry['id']}** ({significant[entry['id']]}): {entry['content'][:100]}...\n"
            analysis += "\n"
        
        # Top tags
        all_tags: Dict[str, int] = {}
        for e in entries:
            for tag in e['tags']:
                all_tags[tag] = all_tags.get(tag, 0) + 1
        
        if all_tags:
            analysis += f"## 🏷️ Top Tags\n"
            for tag, count in sorted(all_tags.items(), key=lambda x: x[1], reverse=True)[:10]:
                analysis += f"- {tag}: {count}\n"
            analysis += "\n"
        
        # Key insights section
        analysis += f"## 💡 Ready for Analysis\n"
        analysis += f"The data above shows your activity from {start_date} to {end_date}. "
        analysis += f"Use this information to identify patterns, celebrate wins, and plan improvements.\n"

    return types.GetPromptResult(
        description=f"Period analysis from {start_date} to {end_date}",
        messages=[
            PromptMessage(
                role="user",
                content=types.TextContent(type="text", text=analysis)
            )
        ]
    )


async def handle_prepare_standup(arguments: Dict[str, str]) -> types.GetPromptResult:
    """Handle prepare-standup prompt."""
    if db is None:
        raise RuntimeError("Analysis prompts not initialized.")
    
    # Capture for use in nested functions
    _db = db
    
    days_back = int(arguments.get("days_back", "1"))
    
    def get_standup_data():
        with _db.get_connection() as conn:
            cursor = conn.execute("""
                SELECT m.id, m.entry_type, m.content, m.timestamp
                FROM memory_journal m
                WHERE m.deleted_at IS NULL
                AND m.is_personal = 0
                AND DATE(m.timestamp) >= DATE('now', '-' || ? || ' days')
                ORDER BY m.timestamp DESC
            """, (days_back,))
            
            return [dict(row) for row in cursor.fetchall()]

    loop = asyncio.get_event_loop()
    entries = await loop.run_in_executor(thread_pool, get_standup_data)

    standup = f"# 🎯 Daily Standup Summary\n\n"
    standup += f"*Last {days_back} day(s) of technical work*\n\n"
    
    if not entries:
        standup += "## ✅ What I Did\n"
        standup += "No technical entries logged in the specified period.\n\n"
    else:
        # Group by achievements, blockers, and plans
        achievements: list[Dict[str, Any]] = []
        blockers: list[Dict[str, Any]] = []
        others: list[Dict[str, Any]] = []
        
        for entry in entries:
            content_lower = entry['content'].lower()
            if 'blocked' in content_lower or 'issue' in content_lower or 'problem' in content_lower:
                blockers.append(entry)
            elif entry['entry_type'] in ['technical_achievement', 'milestone']:
                achievements.append(entry)
            else:
                others.append(entry)
        
        if achievements:
            standup += "## ✅ What I Did\n"
            for entry in achievements:
                preview = entry['content'][:200] + ('...' if len(entry['content']) > 200 else '')
                standup += f"- {preview}\n"
            standup += "\n"
        
        if blockers:
            standup += "## 🚧 Blockers/Issues\n"
            for entry in blockers:
                preview = entry['content'][:200] + ('...' if len(entry['content']) > 200 else '')
                standup += f"- {preview}\n"
            standup += "\n"
        
        if others:
            standup += "## 📝 Other Work\n"
            for entry in others[:5]:  # Limit to 5
                preview = entry['content'][:150] + ('...' if len(entry['content']) > 150 else '')
                standup += f"- {preview}\n"
            standup += "\n"

    standup += "## 🎯 What's Next\n"
    standup += "*Add your plans for today here*\n"

    return types.GetPromptResult(
        description="Daily standup preparation",
        messages=[
            PromptMessage(
                role="user",
                content=types.TextContent(type="text", text=standup)
            )
        ]
    )


async def handle_prepare_retro(arguments: Dict[str, str]) -> types.GetPromptResult:
    """Handle prepare-retro prompt."""
    if db is None:
        raise RuntimeError("Analysis prompts not initialized.")
    
    # Capture for use in nested functions
    _db = db
    
    sprint_start = arguments.get("sprint_start")
    sprint_end = arguments.get("sprint_end")

    def get_retro_data():
        with _db.get_connection() as conn:
            cursor = conn.execute("""
                SELECT m.id, m.entry_type, m.content, m.timestamp, m.is_personal
                FROM memory_journal m
                WHERE m.deleted_at IS NULL
                AND DATE(m.timestamp) >= DATE(?)
                AND DATE(m.timestamp) <= DATE(?)
                ORDER BY m.timestamp
            """, (sprint_start, sprint_end))
            
            entries = [dict(row) for row in cursor.fetchall()]
            
            # Get significant entries
            cursor = conn.execute("""
                SELECT se.entry_id, se.significance_type
                FROM significant_entries se
                JOIN memory_journal m ON se.entry_id = m.id
                WHERE DATE(m.timestamp) >= DATE(?)
                AND DATE(m.timestamp) <= DATE(?)
                AND m.deleted_at IS NULL
            """, (sprint_start, sprint_end))
            
            significant = {row[0]: row[1] for row in cursor.fetchall()}
            
            return entries, significant

    loop = asyncio.get_event_loop()
    entries, significant = await loop.run_in_executor(thread_pool, get_retro_data)

    retro = f"# 🔄 Sprint Retrospective\n\n"
    retro += f"**Sprint Period**: {sprint_start} to {sprint_end}\n"
    retro += f"**Total Entries**: {len(entries)}\n\n"

    if not entries:
        retro += "No entries found for this sprint period.\n"
    else:
        # What went well
        went_well: list[Dict[str, Any]] = [e for e in entries if e['entry_type'] in ['technical_achievement', 'milestone'] or e['id'] in significant]
        if went_well:
            retro += "## ✅ What Went Well\n"
            for entry in went_well:
                sig_marker = f" ({significant.get(entry['id'], '')})" if entry['id'] in significant else ""
                preview = entry['content'][:200] + ('...' if len(entry['content']) > 200 else '')
                retro += f"- **Entry #{entry['id']}**{sig_marker}: {preview}\n"
            retro += "\n"
        
        # What could be improved (looking for entries with problem indicators)
        improvements: list[Dict[str, Any]] = []
        for entry in entries:
            content_lower = entry['content'].lower()
            if any(word in content_lower for word in ['struggled', 'difficult', 'challenge', 'problem', 'issue', 'blocked']):
                improvements.append(entry)
        
        if improvements:
            retro += "## 🔧 What Could Be Improved\n"
            for entry in improvements[:10]:  # Limit to 10
                preview = entry['content'][:200] + ('...' if len(entry['content']) > 200 else '')
                retro += f"- **Entry #{entry['id']}**: {preview}\n"
            retro += "\n"
        
        # Action items section
        retro += "## 🎯 Action Items\n"
        retro += "*Based on the above, what specific actions should we take?*\n"
        retro += "- [ ] Action item 1\n"
        retro += "- [ ] Action item 2\n"

    return types.GetPromptResult(
        description=f"Sprint retrospective for {sprint_start} to {sprint_end}",
        messages=[
            PromptMessage(
                role="user",
                content=types.TextContent(type="text", text=retro)
            )
        ]
    )

