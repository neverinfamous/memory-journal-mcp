"""
Memory Journal MCP Server - MCP Resources Module
Resource handlers for MCP protocol (recent entries, significant entries, graphs, timelines).
"""

import asyncio
import json
from datetime import datetime, timedelta
from typing import List, Optional
from concurrent.futures import ThreadPoolExecutor

from mcp.types import Resource
from pydantic import AnyUrl
from pydantic_core import Url

from database.base import MemoryJournalDB
from database.context import ProjectContextManager
from database.team_db import TeamDatabaseManager
from github.integration import GitHubProjectsIntegration
from constants import THREAD_POOL_MAX_WORKERS, TEAM_DB_PATH
import sys

# These will be initialized by the main server
db: Optional[MemoryJournalDB] = None
github_projects: Optional[GitHubProjectsIntegration] = None
project_context_manager: Optional[ProjectContextManager] = None
thread_pool: Optional[ThreadPoolExecutor] = None
team_db: Optional[TeamDatabaseManager] = None


def initialize_resource_handlers(db_instance: MemoryJournalDB,
                                  github_projects_instance: GitHubProjectsIntegration,
                                  project_context_manager_instance: ProjectContextManager):
    """Initialize resource handlers with required dependencies."""
    global db, github_projects, project_context_manager, thread_pool, team_db
    db = db_instance
    github_projects = github_projects_instance
    project_context_manager = project_context_manager_instance
    thread_pool = ThreadPoolExecutor(max_workers=THREAD_POOL_MAX_WORKERS)
    # Initialize team database manager (v2.0.0 Team Collaboration)
    try:
        team_db = TeamDatabaseManager(TEAM_DB_PATH)
        print("[INFO] Team database manager initialized for resources", file=sys.stderr)
    except Exception as e:
        print(f"[WARNING] Team database resource initialization failed: {e}", file=sys.stderr)
        team_db = None


def parse_resource_uri(uri_str: str) -> dict:
    """
    Parse resource URI and extract parameters.
    
    Supports:
    - memory://issues/{number}/entries
    - memory://prs/{number}/entries
    - memory://prs/{number}/timeline
    
    Returns:
        Dict with 'type' and relevant ID fields, or {'type': 'unknown'}
    """
    import re
    
    # memory://issues/{number}/entries
    if match := re.match(r'memory://issues/(\d+)/entries', uri_str):
        return {'type': 'issue_entries', 'issue_number': int(match.group(1))}
    
    # memory://prs/{number}/entries
    if match := re.match(r'memory://prs/(\d+)/entries', uri_str):
        return {'type': 'pr_entries', 'pr_number': int(match.group(1))}
    
    # memory://prs/{number}/timeline
    if match := re.match(r'memory://prs/(\d+)/timeline', uri_str):
        return {'type': 'pr_timeline', 'pr_number': int(match.group(1))}
    
    return {'type': 'unknown'}


async def list_resources() -> List[Resource]:
    """List available resources."""
    return [
        Resource(
            uri=Url("memory://recent"),  # type: ignore[arg-type]
            name="Recent Journal Entries",
            description="Most recent journal entries",
            mimeType="application/json"
        ),
        Resource(
            uri=Url("memory://significant"),  # type: ignore[arg-type]
            name="Significant Entries",
            description="Entries marked as significant",
            mimeType="application/json"
        ),
        Resource(
            uri=Url("memory://graph/recent"),  # type: ignore[arg-type]
            name="Relationship Graph (Recent)",
            description="Mermaid graph visualization of recent entries with relationships",
            mimeType="text/plain"
        ),
        Resource(
            uri=Url("memory://team/recent"),  # type: ignore[arg-type]
            name="Team Shared Entries (v2.0.0)",
            description="Most recent team-shared journal entries from .memory-journal-team.db",
            mimeType="application/json"
        ),
        Resource(
            uri=Url("memory://projects/{project_identifier}/timeline"),  # type: ignore[arg-type]
            name="Project Activity Timeline (Phase 2 & 3)",
            description="Chronological timeline of journal entries and GitHub Project activity for a specific project. Supports: memory://projects/{number}/timeline, memory://projects/{name}/timeline, or memory://projects/{owner}/{owner_type}/{number}/timeline",
            mimeType="text/markdown"
        ),
        Resource(
            uri=Url("memory://issues/{issue_number}/entries"),  # type: ignore[arg-type]
            name="Issue Journal Entries (Phase 3)",
            description="All journal entries linked to a specific GitHub Issue",
            mimeType="application/json"
        ),
        Resource(
            uri=Url("memory://prs/{pr_number}/entries"),  # type: ignore[arg-type]
            name="Pull Request Journal Entries (Phase 3)",
            description="All journal entries linked to a specific GitHub Pull Request",
            mimeType="application/json"
        ),
        Resource(
            uri=Url("memory://prs/{pr_number}/timeline"),  # type: ignore[arg-type]
            name="Pull Request Activity Timeline (Phase 3)",
            description="Combined timeline of journal entries and PR events (commits, reviews, status changes)",
            mimeType="text/markdown"
        )
    ]


async def read_resource(uri: AnyUrl) -> str:
    """Read a specific resource."""
    if db is None or github_projects is None or project_context_manager is None or thread_pool is None:
        raise RuntimeError("Resource handlers not initialized.")
    
    # Convert URI to string (AnyUrl is always a valid URL object)
    uri_str = str(uri).strip()

    if uri_str == "memory://recent":
        try:
            def get_recent_entries():
                with db.get_connection() as conn:
                    cursor = conn.execute("""
                        SELECT id, entry_type, content, timestamp, is_personal, project_context
                        FROM memory_journal
                        ORDER BY timestamp DESC
                        LIMIT 10
                    """)
                    entries = [dict(row) for row in cursor.fetchall()]
                    return entries

            # Run in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            entries = await loop.run_in_executor(thread_pool, get_recent_entries)
            return json.dumps(entries, indent=2)
        except Exception as e:
            raise

    elif uri_str == "memory://significant":
        try:
            def get_significant_entries():
                with db.get_connection() as conn:
                    cursor = conn.execute("""
                        SELECT se.significance_type, se.significance_rating,
                               mj.id, mj.entry_type, mj.content, mj.timestamp
                        FROM significant_entries se
                        JOIN memory_journal mj ON se.entry_id = mj.id
                        ORDER BY se.significance_rating DESC
                        LIMIT 10
                    """)
                    entries = [dict(row) for row in cursor.fetchall()]
                    return entries

            # Run in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            entries = await loop.run_in_executor(thread_pool, get_significant_entries)
            return json.dumps(entries, indent=2)
        except Exception as e:
            raise

    elif uri_str == "memory://team/recent":
        # v2.0.0 Team Collaboration: Team-shared entries resource
        try:
            if not team_db:
                return json.dumps({"error": "Team database not available"}, indent=2)
            
            def get_team_entries():
                return team_db.get_team_entries(limit=10)
            
            # Run in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            entries = await loop.run_in_executor(thread_pool, get_team_entries)
            
            # Format entries for better readability
            formatted_entries = []
            for entry in entries:
                formatted_entry = {
                    'id': entry.get('id'),
                    'entry_type': entry.get('entry_type'),
                    'content': entry.get('content'),
                    'timestamp': entry.get('timestamp'),
                    'tags': entry.get('tags', []),
                    'project_number': entry.get('project_number'),
                    'source': 'team_shared'
                }
                formatted_entries.append(formatted_entry)
            
            return json.dumps({
                'count': len(formatted_entries),
                'entries': formatted_entries
            }, indent=2)
        except Exception as e:
            return json.dumps({"error": f"Failed to retrieve team entries: {str(e)}"}, indent=2)
    
    elif uri_str == "memory://graph/recent":
        try:
            def get_graph():
                with db.get_connection() as conn:
                    # Get recent entries that have relationships
                    cursor = conn.execute("""
                        SELECT DISTINCT mj.id, mj.entry_type, mj.content, mj.is_personal
                        FROM memory_journal mj
                        WHERE mj.deleted_at IS NULL
                          AND mj.id IN (
                              SELECT DISTINCT from_entry_id FROM relationships
                              UNION
                              SELECT DISTINCT to_entry_id FROM relationships
                          )
                        ORDER BY mj.timestamp DESC
                        LIMIT 20
                    """)
                    entries = {row[0]: dict(row) for row in cursor.fetchall()}

                    if not entries:
                        return None, None

                    # Get relationships between these entries
                    entry_ids = list(entries.keys())
                    placeholders = ','.join(['?' for _ in entry_ids])
                    cursor = conn.execute(f"""
                        SELECT from_entry_id, to_entry_id, relationship_type
                        FROM relationships
                        WHERE from_entry_id IN ({placeholders})
                          AND to_entry_id IN ({placeholders})
                    """, entry_ids + entry_ids)
                    relationships = cursor.fetchall()

                    return entries, relationships

            loop = asyncio.get_event_loop()
            entries, relationships = await loop.run_in_executor(thread_pool, get_graph)

            if not entries:
                return "No entries with relationships found"

            # Generate Mermaid diagram
            mermaid = "```mermaid\ngraph TD\n"
            
            for entry_id, entry in entries.items():
                content_preview = entry['content'][:40].replace('\n', ' ')
                if len(entry['content']) > 40:
                    content_preview += '...'
                content_preview = content_preview.replace('"', "'").replace('[', '(').replace(']', ')')
                
                entry_type_short = entry['entry_type'][:20]
                node_label = f"#{entry_id}: {content_preview}<br/>{entry_type_short}"
                mermaid += f"    E{entry_id}[\"{node_label}\"]\n"

            mermaid += "\n"

            relationship_symbols = {
                'references': '-->',
                'implements': '==>',
                'clarifies': '-.->',
                'evolves_from': '-->',
                'response_to': '<-->'
            }

            if relationships:
                for rel in relationships:
                    from_id, to_id, rel_type = rel
                    arrow = relationship_symbols.get(rel_type, '-->')
                    mermaid += f"    E{from_id} {arrow}|{rel_type}| E{to_id}\n"

            mermaid += "\n"
            for entry_id, entry in entries.items():
                if entry['is_personal']:
                    mermaid += f"    style E{entry_id} fill:#E3F2FD\n"
                else:
                    mermaid += f"    style E{entry_id} fill:#FFF3E0\n"

            mermaid += "```"
            
            return mermaid
        except Exception as e:
            raise

    elif uri_str.startswith("memory://projects/") and "/timeline" in uri_str:
        # Phase 2 - Issue #16: Project Timeline Resource (Phase 3: org support + name lookup)
        try:
            # Extract parameters from URI
            # Supports: 
            # - memory://projects/1/timeline (number)
            # - memory://projects/memory-journal-mcp/timeline (name)
            # - memory://projects/my-company/org/1/timeline (owner/type/number)
            parts = uri_str.split("/")
            
            # Determine format
            if len(parts) == 5:  # memory://projects/{number_or_name}/timeline
                identifier = parts[3]
                owner = None
                owner_type = 'user'
                
                # Try to parse as integer (project number)
                try:
                    project_number = int(identifier)
                except ValueError:
                    # It's a project name - look it up from current GitHub context
                    # Note: This uses the CURRENT project name from GitHub, not historical names
                    # stored in old journal entries' project_context fields
                    project_number = None
                    project_name = identifier
                    
                    # Get project context to find the number
                    project_context = await project_context_manager.get_project_context()
                    if 'github_projects' in project_context:
                        all_projects = project_context['github_projects'].get('user_projects', []) + \
                                     project_context['github_projects'].get('org_projects', [])
                        
                        # Search for project by name (case-insensitive)
                        for proj in all_projects:
                            if proj.get('name', '').lower() == project_name.lower():
                                project_number = proj.get('number')
                                owner = proj.get('owner')
                                break
                        
                        if project_number is None:
                            raise ValueError(f"Project '{project_name}' not found in GitHub context. Available projects: {[p.get('name') for p in all_projects]}")
                
            elif len(parts) == 7:  # memory://projects/{owner}/{owner_type}/{number}/timeline
                owner = parts[3]
                owner_type = parts[4] if parts[4] in ['user', 'org'] else 'user'
                project_number = int(parts[5])
            else:
                raise ValueError(f"Invalid URI format. Expected: memory://projects/{{number_or_name}}/timeline or memory://projects/{{owner}}/{{owner_type}}/{{number}}/timeline")

            def get_timeline_data():
                with db.get_connection() as conn:
                    # Get journal entries for this project (last 30 days)
                    cutoff_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
                    
                    cursor = conn.execute("""
                        SELECT id, entry_type, content, timestamp
                        FROM memory_journal
                        WHERE project_number = ? AND deleted_at IS NULL
                          AND DATE(timestamp) >= DATE(?)
                        ORDER BY timestamp DESC
                        LIMIT 50
                    """, (project_number, cutoff_date))
                    entries = [dict(row) for row in cursor.fetchall()]
                    return entries

            loop = asyncio.get_event_loop()
            entries = await loop.run_in_executor(thread_pool, get_timeline_data)

            # Get GitHub project timeline if available (Phase 3: use owner param if provided)
            project_context = await project_context_manager.get_project_context()
            if not owner and 'repo_path' in project_context:
                owner = github_projects._extract_repo_owner_from_remote(project_context['repo_path'])
                if owner:
                    owner_type = github_projects.detect_owner_type(owner)

            github_timeline = []
            if owner and github_projects.api_manager:
                github_timeline = github_projects.api_manager.get_project_timeline(owner, project_number, days=30, owner_type=owner_type)

            # Combine timelines
            combined = []
            
            # Add journal entries
            for entry in entries:
                combined.append({
                    'type': 'journal_entry',
                    'timestamp': entry['timestamp'],
                    'id': entry['id'],
                    'entry_type': entry['entry_type'],
                    'content': entry['content'][:200] + ('...' if len(entry['content']) > 200 else '')
                })
            
            # Add GitHub project items
            combined.extend(github_timeline)
            
            # Sort by timestamp
            combined.sort(key=lambda x: x['timestamp'], reverse=True)
            
            # Format as Markdown timeline
            timeline = f"# Project #{project_number} Activity Timeline\n\n"
            timeline += f"*Last 30 days of activity - {len(combined)} events*\n\n"
            timeline += "---\n\n"
            
            current_date = None
            for event in combined[:50]:
                event_date = event['timestamp'][:10]
                
                # Add date header when date changes
                if event_date != current_date:
                    timeline += f"\n## {event_date}\n\n"
                    current_date = event_date
                
                # Format event based on type
                if event['type'] == 'journal_entry':
                    timeline += f"### 📝 Journal Entry #{event['id']}\n"
                    timeline += f"**Type:** {event['entry_type']}  \n"
                    timeline += f"**Time:** {event['timestamp'][11:16]}  \n"
                    timeline += f"{event['content']}\n\n"
                elif event['type'] == 'project_item':
                    timeline += f"### 🎯 Project Item Updated\n"
                    timeline += f"**Title:** {event['title']}  \n"
                    timeline += f"**Status:** {event['status']}  \n"
                    timeline += f"**Type:** {event['content_type']}  \n\n"
            
            if not combined:
                timeline += "*No activity in the last 30 days*\n"
            
            return timeline
            
        except (ValueError, IndexError) as e:
            raise ValueError(f"Invalid project timeline URI: {uri_str}. Expected format: memory://projects/<number>/timeline")
        except Exception as e:
            raise

    elif uri_str.startswith("memory://issues/") and "/entries" in uri_str:
        # Phase 3: Issue Journal Entries Resource
        try:
            parsed = parse_resource_uri(uri_str)
            if parsed['type'] != 'issue_entries':
                raise ValueError(f"Invalid issue entries URI: {uri_str}")
            
            issue_number = parsed['issue_number']
            
            def get_issue_entries():
                with db.get_connection() as conn:
                    # Get all entries for this issue
                    cursor = conn.execute("""
                        SELECT id, entry_type, content, timestamp, is_personal, 
                               pr_number, project_number, project_context
                        FROM memory_journal
                        WHERE issue_number = ? AND deleted_at IS NULL
                        ORDER BY timestamp ASC
                    """, (issue_number,))
                    entries = [dict(row) for row in cursor.fetchall()]
                    
                    # Get tags for each entry
                    for entry in entries:
                        cursor = conn.execute("""
                            SELECT t.name FROM tags t
                            JOIN entry_tags et ON t.id = et.tag_id
                            WHERE et.entry_id = ?
                        """, (entry['id'],))
                        entry['tags'] = [row[0] for row in cursor.fetchall()]
                    
                    return entries
            
            loop = asyncio.get_event_loop()
            entries = await loop.run_in_executor(thread_pool, get_issue_entries)
            
            # Format as JSON
            result = {
                "issue_number": issue_number,
                "entry_count": len(entries),
                "entries": []
            }
            
            for entry in entries:
                result["entries"].append({
                    "id": entry['id'],
                    "entry_type": entry['entry_type'],
                    "content": entry['content'],
                    "timestamp": entry['timestamp'],
                    "is_personal": bool(entry['is_personal']),
                    "tags": entry['tags'],
                    "pr_number": entry.get('pr_number'),
                    "project_number": entry.get('project_number')
                })
            
            return json.dumps(result, indent=2)
            
        except Exception as e:
            raise ValueError(f"Error reading issue entries: {str(e)}")

    elif uri_str.startswith("memory://prs/") and "/entries" in uri_str:
        # Phase 3: PR Journal Entries Resource
        try:
            parsed = parse_resource_uri(uri_str)
            if parsed['type'] != 'pr_entries':
                raise ValueError(f"Invalid PR entries URI: {uri_str}")
            
            pr_number = parsed['pr_number']
            
            def get_pr_entries():
                with db.get_connection() as conn:
                    # Get all entries for this PR
                    cursor = conn.execute("""
                        SELECT id, entry_type, content, timestamp, is_personal, 
                               pr_status, issue_number, project_number, project_context
                        FROM memory_journal
                        WHERE pr_number = ? AND deleted_at IS NULL
                        ORDER BY timestamp ASC
                    """, (pr_number,))
                    entries = [dict(row) for row in cursor.fetchall()]
                    
                    # Get tags for each entry
                    for entry in entries:
                        cursor = conn.execute("""
                            SELECT t.name FROM tags t
                            JOIN entry_tags et ON t.id = et.tag_id
                            WHERE et.entry_id = ?
                        """, (entry['id'],))
                        entry['tags'] = [row[0] for row in cursor.fetchall()]
                    
                    return entries
            
            loop = asyncio.get_event_loop()
            entries = await loop.run_in_executor(thread_pool, get_pr_entries)
            
            # Collect PR status summary and linked issues
            pr_statuses = set()
            linked_issues = set()
            for entry in entries:
                if entry.get('pr_status'):
                    pr_statuses.add(entry['pr_status'])
                if entry.get('issue_number'):
                    linked_issues.add(entry['issue_number'])
            
            # Format as JSON
            result = {
                "pr_number": pr_number,
                "entry_count": len(entries),
                "pr_status_summary": list(pr_statuses),
                "linked_issues": sorted(list(linked_issues)),
                "entries": []
            }
            
            for entry in entries:
                result["entries"].append({
                    "id": entry['id'],
                    "entry_type": entry['entry_type'],
                    "content": entry['content'],
                    "timestamp": entry['timestamp'],
                    "is_personal": bool(entry['is_personal']),
                    "tags": entry['tags'],
                    "pr_status": entry.get('pr_status'),
                    "issue_number": entry.get('issue_number'),
                    "project_number": entry.get('project_number')
                })
            
            return json.dumps(result, indent=2)
            
        except Exception as e:
            raise ValueError(f"Error reading PR entries: {str(e)}")

    elif uri_str.startswith("memory://prs/") and "/timeline" in uri_str:
        # Phase 3: PR Timeline Resource
        try:
            parsed = parse_resource_uri(uri_str)
            if parsed['type'] != 'pr_timeline':
                raise ValueError(f"Invalid PR timeline URI: {uri_str}")
            
            pr_number = parsed['pr_number']
            
            def get_pr_journal_entries():
                with db.get_connection() as conn:
                    # Get journal entries for this PR
                    cursor = conn.execute("""
                        SELECT id, entry_type, content, timestamp, project_context
                        FROM memory_journal
                        WHERE pr_number = ? AND deleted_at IS NULL
                        ORDER BY timestamp ASC
                    """, (pr_number,))
                    return [dict(row) for row in cursor.fetchall()]
            
            loop = asyncio.get_event_loop()
            journal_entries = await loop.run_in_executor(thread_pool, get_pr_journal_entries)
            
            # Get PR details from GitHub
            pr_details = None
            owner = None
            repo = None
            
            # Try to extract owner/repo from first journal entry's context
            if journal_entries and journal_entries[0].get('project_context'):
                from github.api import extract_repo_info_from_context
                owner, repo = extract_repo_info_from_context(journal_entries[0]['project_context'])
            
            # If not found, get from current context
            if not owner or not repo:
                project_context = await project_context_manager.get_project_context()
                if 'repo_path' in project_context:
                    owner = github_projects._extract_repo_owner_from_remote(project_context['repo_path'])
                    repo = project_context.get('repo_name')
            
            # Fetch PR details if we have owner/repo
            if owner and repo and github_projects.github_token:
                from github.api import get_pr_details
                try:
                    pr_details = get_pr_details(github_projects, owner, repo, pr_number)
                except Exception as e:
                    print(f"[WARNING] Failed to fetch PR details: {e}", file=sys.stderr)
            
            # Combine timeline events
            combined = []
            
            # Add journal entries
            for entry in journal_entries:
                combined.append({
                    'type': 'journal_entry',
                    'timestamp': entry['timestamp'],
                    'id': entry['id'],
                    'entry_type': entry['entry_type'],
                    'content': entry['content'][:200] + ('...' if len(entry['content']) > 200 else '')
                })
            
            # Add PR events from GitHub
            if pr_details:
                # PR created event
                if pr_details.get('created_at'):
                    combined.append({
                        'type': 'pr_created',
                        'timestamp': pr_details['created_at'],
                        'author': pr_details.get('author', 'Unknown'),
                        'title': pr_details.get('title', ''),
                        'draft': pr_details.get('draft', False)
                    })
                
                # PR merged event
                if pr_details.get('merged_at'):
                    combined.append({
                        'type': 'pr_merged',
                        'timestamp': pr_details['merged_at'],
                        'base_branch': pr_details.get('base_branch', 'main')
                    })
                
                # PR closed event (if closed but not merged)
                if pr_details.get('closed_at') and not pr_details.get('merged_at'):
                    combined.append({
                        'type': 'pr_closed',
                        'timestamp': pr_details['closed_at']
                    })
            
            # Sort chronologically
            combined.sort(key=lambda x: x['timestamp'])
            
            # Format as Markdown timeline
            timeline = f"# Pull Request #{pr_number} Activity Timeline\n\n"
            
            if pr_details:
                timeline += f"**Title:** {pr_details.get('title', 'Unknown')}  \n"
                timeline += f"**Author:** {pr_details.get('author', 'Unknown')}  \n"
                timeline += f"**Status:** {pr_details.get('state', 'unknown')}"
                if pr_details.get('draft'):
                    timeline += " (draft)"
                timeline += "  \n"
                if pr_details.get('url'):
                    timeline += f"**URL:** {pr_details['url']}  \n"
                timeline += "\n"
            
            timeline += f"*{len(combined)} events*\n\n"
            timeline += "---\n\n"
            
            current_date = None
            for event in combined:
                event_timestamp = event['timestamp']
                event_date = event_timestamp[:10] if isinstance(event_timestamp, str) else event_timestamp.split('T')[0]
                
                # Add date header when date changes
                if event_date != current_date:
                    timeline += f"\n## {event_date}\n\n"
                    current_date = event_date
                
                # Extract time
                event_time = event_timestamp[11:16] if len(event_timestamp) > 16 else event_timestamp.split('T')[1][:5] if 'T' in event_timestamp else '00:00'
                
                # Format event based on type
                if event['type'] == 'journal_entry':
                    timeline += f"### 📝 Journal Entry #{event['id']} - {event_time}\n"
                    timeline += f"**Type:** {event['entry_type']}  \n"
                    timeline += f"{event['content']}\n\n"
                elif event['type'] == 'pr_created':
                    timeline += f"### 🚀 Pull Request Created - {event_time}\n"
                    timeline += f"**Author:** {event['author']}  \n"
                    timeline += f"**Title:** {event['title']}  \n"
                    if event.get('draft'):
                        timeline += f"**Status:** Draft  \n"
                    timeline += "\n"
                elif event['type'] == 'pr_merged':
                    timeline += f"### ✅ Pull Request Merged - {event_time}\n"
                    timeline += f"**Target:** {event['base_branch']}  \n\n"
                elif event['type'] == 'pr_closed':
                    timeline += f"### ❌ Pull Request Closed - {event_time}\n\n"
            
            if not combined:
                timeline += "*No activity found for this PR*\n"
            
            return timeline
            
        except Exception as e:
            raise ValueError(f"Error reading PR timeline: {str(e)}")

    else:
        raise ValueError(f"Unknown resource: {uri_str}")
