"""
Memory Journal MCP Server - Analytics Tool Handlers
Handlers for statistics and cross-project analytics.
"""

import asyncio
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from concurrent.futures import ThreadPoolExecutor

import mcp.types as types

from database.base import MemoryJournalDB

# These will be initialized by the main server
db: Optional[MemoryJournalDB] = None
thread_pool: Optional[ThreadPoolExecutor] = None


def initialize_analytics_handlers(db_instance: MemoryJournalDB, thread_pool_instance: ThreadPoolExecutor):
    """Initialize the analytics handlers with database instance."""
    global db, thread_pool
    db = db_instance
    thread_pool = thread_pool_instance


async def handle_get_statistics(arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle getting journal statistics and analytics."""
    if db is None:
        raise RuntimeError("Analytics handlers not initialized.")
    
    # Capture for use in nested functions
    _db = db
    
    start_date = arguments.get("start_date")
    end_date = arguments.get("end_date")
    group_by = arguments.get("group_by", "week")
    project_breakdown = arguments.get("project_breakdown", False)

    def calculate_stats() -> Dict[str, Any]:
        with _db.get_connection() as conn:
            stats: Dict[str, Any] = {}

            # Base WHERE clause
            where = "WHERE deleted_at IS NULL"
            params: list[Any] = []
            
            if start_date:
                where += " AND DATE(timestamp) >= DATE(?)"
                params.append(start_date)
            if end_date:
                where += " AND DATE(timestamp) <= DATE(?)"
                params.append(end_date)

            # Total entries
            cursor = conn.execute(f"SELECT COUNT(*) FROM memory_journal {where}", params)
            stats['total_entries'] = cursor.fetchone()[0]

            # Entries by type
            cursor = conn.execute(f"""
                SELECT entry_type, COUNT(*) as count
                FROM memory_journal {where}
                GROUP BY entry_type
                ORDER BY count DESC
            """, params)
            stats['by_type'] = {row[0]: row[1] for row in cursor.fetchall()}

            # Personal vs Project
            cursor = conn.execute(f"""
                SELECT is_personal, COUNT(*) as count
                FROM memory_journal {where}
                GROUP BY is_personal
            """, params)
            personal_stats = {bool(row[0]): row[1] for row in cursor.fetchall()}
            stats['personal_entries'] = personal_stats.get(True, 0)
            stats['project_entries'] = personal_stats.get(False, 0)

            # Top tags
            cursor = conn.execute(f"""
                SELECT t.name, COUNT(*) as count
                FROM tags t
                JOIN entry_tags et ON t.id = et.tag_id
                JOIN memory_journal m ON et.entry_id = m.id
                {where}
                GROUP BY t.name
                ORDER BY count DESC
                LIMIT 10
            """, params)
            stats['top_tags'] = {row[0]: row[1] for row in cursor.fetchall()}

            # Significant entries
            cursor = conn.execute(f"""
                SELECT se.significance_type, COUNT(*) as count
                FROM significant_entries se
                JOIN memory_journal m ON se.entry_id = m.id
                {where}
                GROUP BY se.significance_type
            """, params)
            stats['significant_entries'] = {row[0]: row[1] for row in cursor.fetchall()}

            # Activity by period
            if group_by == "day":
                date_format = "%Y-%m-%d"
            elif group_by == "month":
                date_format = "%Y-%m"
            else:  # week
                date_format = "%Y-W%W"

            cursor = conn.execute(f"""
                SELECT strftime('{date_format}', timestamp) as period, COUNT(*) as count
                FROM memory_journal {where}
                GROUP BY period
                ORDER BY period
            """, params)
            stats['activity_by_period'] = {row[0]: row[1] for row in cursor.fetchall()}

            # Phase 2 - Project Breakdown
            if project_breakdown:
                cursor = conn.execute(f"""
                    SELECT project_number, COUNT(*) as count
                    FROM memory_journal
                    {where} AND project_number IS NOT NULL
                    GROUP BY project_number
                    ORDER BY count DESC
                """, params)
                stats['by_project'] = {f"Project #{row[0]}": row[1] for row in cursor.fetchall()}
                
                # Active days per project
                cursor = conn.execute(f"""
                    SELECT project_number, COUNT(DISTINCT DATE(timestamp)) as active_days
                    FROM memory_journal
                    {where} AND project_number IS NOT NULL
                    GROUP BY project_number
                    ORDER BY active_days DESC
                """, params)
                stats['project_active_days'] = {f"Project #{row[0]}": row[1] for row in cursor.fetchall()}

            return stats

    loop = asyncio.get_event_loop()
    stats = await loop.run_in_executor(thread_pool, calculate_stats)

    # Format output
    output = "📊 **Journal Statistics**\n\n"
    output += f"**Total Entries:** {stats['total_entries']}\n"
    output += f"**Personal:** {stats['personal_entries']} | **Project:** {stats['project_entries']}\n\n"

    if stats['by_type']:
        output += "**Entries by Type:**\n"
        for entry_type, count in stats['by_type'].items():
            output += f"  • {entry_type}: {count}\n"
        output += "\n"

    if stats['top_tags']:
        output += "**Top Tags:**\n"
        for tag, count in list(stats['top_tags'].items())[:10]:
            output += f"  • {tag}: {count}\n"
        output += "\n"

    if stats['significant_entries']:
        output += "**Significant Entries:**\n"
        for sig_type, count in stats['significant_entries'].items():
            output += f"  • {sig_type}: {count}\n"
        output += "\n"

    if stats['activity_by_period']:
        output += f"**Activity by {group_by.capitalize()}:**\n"
        for period, count in list(stats['activity_by_period'].items())[-10:]:
            output += f"  • {period}: {count} entries\n"

    # Phase 2 - Project Breakdown
    if project_breakdown and 'by_project' in stats and stats['by_project']:
        output += "\n**📦 Project Breakdown (Phase 2):**\n"
        for project, count in stats['by_project'].items():
            active_days = stats['project_active_days'].get(project, 0)
            output += f"  • {project}: {count} entries ({active_days} active days)\n"
        output += "\n"

    return [types.TextContent(type="text", text=output)]


async def handle_get_cross_project_insights(arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle getting cross-project insights and analytics."""
    if db is None:
        raise RuntimeError("Analytics handlers not initialized.")
    
    # Capture for use in nested functions
    _db = db
    
    # Phase 2 - Issue #16: Cross-project insights
    start_date = arguments.get("start_date")
    end_date = arguments.get("end_date")
    min_entries = arguments.get("min_entries", 3)

    def analyze_projects() -> dict[str, Any]:
        with _db.get_connection() as conn:
            # Base WHERE clause
            where = "WHERE deleted_at IS NULL AND project_number IS NOT NULL"
            params: list[Any] = []
            
            if start_date:
                where += " AND DATE(timestamp) >= DATE(?)"
                params.append(start_date)
            if end_date:
                where += " AND DATE(timestamp) <= DATE(?)"
                params.append(end_date)

            # Get active projects (ranked by entry count)
            cursor = conn.execute(f"""
                SELECT project_number, COUNT(*) as entry_count,
                       MIN(DATE(timestamp)) as first_entry,
                       MAX(DATE(timestamp)) as last_entry,
                       COUNT(DISTINCT DATE(timestamp)) as active_days
                FROM memory_journal {where}
                GROUP BY project_number
                HAVING entry_count >= ?
                ORDER BY entry_count DESC
            """, params + [min_entries])
            projects = [dict(row) for row in cursor.fetchall()]

            # Get most productive day per project
            productivity = {}
            for proj in projects:
                project_num = proj['project_number']
                cursor = conn.execute(f"""
                    SELECT strftime('%A', timestamp) as day_of_week, COUNT(*) as count
                    FROM memory_journal
                    WHERE project_number = ? AND deleted_at IS NULL
                    GROUP BY day_of_week
                    ORDER BY count DESC
                    LIMIT 1
                """, (project_num,))
                result = cursor.fetchone()
                if result:
                    productivity[project_num] = {'day': result[0], 'count': result[1]}

            # Get top tags per project
            project_tags = {}
            for proj in projects:
                project_num = proj['project_number']
                cursor = conn.execute(f"""
                    SELECT t.name, COUNT(*) as count
                    FROM tags t
                    JOIN entry_tags et ON t.id = et.tag_id
                    JOIN memory_journal m ON et.entry_id = m.id
                    WHERE m.project_number = ? AND m.deleted_at IS NULL
                    GROUP BY t.name
                    ORDER BY count DESC
                    LIMIT 5
                """, (project_num,))
                project_tags[project_num] = [dict(row) for row in cursor.fetchall()]

            # Identify low-activity projects (last entry > 7 days ago)
            cutoff_date = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
            cursor = conn.execute(f"""
                SELECT project_number, MAX(DATE(timestamp)) as last_entry_date
                FROM memory_journal
                WHERE deleted_at IS NULL AND project_number IS NOT NULL
                GROUP BY project_number
                HAVING last_entry_date < ?
            """, (cutoff_date,))
            inactive_projects = [dict(row) for row in cursor.fetchall()]

            return {
                'projects': projects,
                'productivity': productivity,
                'project_tags': project_tags,
                'inactive_projects': inactive_projects
            }

    loop = asyncio.get_event_loop()
    insights = await loop.run_in_executor(thread_pool, analyze_projects)

    # Format output
    output = "📊 **Cross-Project Insights (Phase 2)**\n\n"
    
    if not insights['projects']:
        output += f"No projects found with at least {min_entries} entries.\n"
        return [types.TextContent(type="text", text=output)]

    output += f"**Active Projects:** {len(insights['projects'])}\n"
    if start_date or end_date:
        output += f"**Period:** {start_date or 'start'} to {end_date or 'now'}\n"
    output += "\n"

    # Project ranking
    output += "**Projects by Activity:**\n"
    for i, proj in enumerate(insights['projects'][:10], 1):
        proj_num = proj['project_number']
        output += f"{i}. **Project #{proj_num}**\n"
        output += f"   - Entries: {proj['entry_count']}\n"
        output += f"   - Active Days: {proj['active_days']}\n"
        output += f"   - Period: {proj['first_entry']} to {proj['last_entry']}\n"
        
        # Productivity info
        if proj_num in insights['productivity']:
            prod = insights['productivity'][proj_num]
            output += f"   - Most Productive: {prod['day']} ({prod['count']} entries)\n"
        
        # Top tags
        if proj_num in insights['project_tags'] and insights['project_tags'][proj_num]:
            tags = [f"{t['name']} ({t['count']})" for t in insights['project_tags'][proj_num][:3]]
            output += f"   - Top Tags: {', '.join(tags)}\n"
        
        output += "\n"

    # Time distribution summary
    total_entries = sum(p['entry_count'] for p in insights['projects'])
    output += "**Time Distribution:**\n"
    for proj in insights['projects'][:5]:
        percentage = (proj['entry_count'] / total_entries) * 100
        output += f"  • Project #{proj['project_number']}: {percentage:.1f}%\n"
    output += "\n"

    # Suggested focus areas
    if insights['inactive_projects']:
        output += "**⚠️ Suggested Focus Areas (>7 days since last entry):**\n"
        for proj in insights['inactive_projects'][:5]:
            output += f"  • Project #{proj['project_number']} - Last entry: {proj['last_entry_date']}\n"

    return [types.TextContent(type="text", text=output)]

