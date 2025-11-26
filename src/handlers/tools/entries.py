"""
Memory Journal MCP Server - Entry Management Tool Handlers
Handlers for creating, updating, deleting, and retrieving journal entries.
"""

import asyncio
import json
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional, cast
from concurrent.futures import ThreadPoolExecutor

import mcp.types as types

from database.base import MemoryJournalDB
from database.context import ProjectContextManager
from database.team_db import TeamDatabaseManager
from vector_search import VectorSearchManager
from constants import TEAM_DB_PATH

# These will be initialized by the main server
db: Optional[MemoryJournalDB] = None
project_context_manager: Optional[ProjectContextManager] = None
vector_search: Optional[VectorSearchManager] = None
thread_pool: Optional[ThreadPoolExecutor] = None
team_db: Optional[TeamDatabaseManager] = None


def initialize_entry_handlers(db_instance: MemoryJournalDB, 
                               project_context_manager_instance: ProjectContextManager,
                               vector_search_instance: Optional[VectorSearchManager],
                               thread_pool_instance: ThreadPoolExecutor):
    """Initialize the entry handlers with database and vector search instances."""
    global db, project_context_manager, vector_search, thread_pool, team_db
    db = db_instance
    project_context_manager = project_context_manager_instance
    vector_search = vector_search_instance
    thread_pool = thread_pool_instance
    # Initialize team database manager
    try:
        team_db = TeamDatabaseManager(TEAM_DB_PATH)
        print("[INFO] Team database manager initialized", file=sys.stderr)
    except Exception as e:
        print(f"[WARNING] Team database initialization failed: {e}", file=sys.stderr)
        team_db = None


async def handle_create_entry(arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle creating a new journal entry with context and tags."""
    if db is None or project_context_manager is None:
        raise RuntimeError("Entry handlers not initialized.")
    
    # Capture for use in nested functions
    _db = db
    _pcm = project_context_manager
    _team_db = team_db
    
    content = arguments["content"]
    is_personal = arguments.get("is_personal", True)
    entry_type = arguments.get("entry_type", "personal_reflection")
    tags: list[str] = arguments.get("tags", [])
    significance_type: Optional[str] = arguments.get("significance_type")
    auto_context = arguments.get("auto_context", True)
    share_with_team = arguments.get("share_with_team", False)  # v2.0.0 Team Collaboration
    
    # GitHub Projects parameters (Phase 1 - Issue #15, Phase 3 - Issue #17)
    project_number: int | None = arguments.get("project_number")
    project_item_id: int | None = arguments.get("project_item_id")
    github_project_url: str | None = arguments.get("github_project_url")
    project_owner: str | None = arguments.get("project_owner")  # Phase 3
    project_owner_type: str | None = arguments.get("project_owner_type")  # Phase 3
    
    # GitHub Issues parameters
    issue_number: int | None = arguments.get("issue_number")
    issue_url: str | None = arguments.get("issue_url")
    
    # GitHub Pull Requests parameters
    pr_number: int | None = arguments.get("pr_number")
    pr_url: str | None = arguments.get("pr_url")
    pr_status: str | None = arguments.get("pr_status")
    
    # GitHub Actions parameters
    workflow_run_id: int | None = arguments.get("workflow_run_id")
    workflow_name: str | None = arguments.get("workflow_name")
    workflow_status: str | None = arguments.get("workflow_status")

    # Validate input for security
    try:
        db.validate_input(content, entry_type, tags, significance_type)
    except ValueError as e:
        return [types.TextContent(
            type="text",
            text=f"❌ Input validation failed: {str(e)}"
        )]

    project_context = None
    context_data = None
    if auto_context:
        context_data = await _pcm.get_project_context()
        project_context = json.dumps(context_data)
        
        # Auto-populate project info from context if not explicitly set (Phase 3: org support)
        if not project_number and context_data and 'github_projects' in context_data:
            # Extract GitHub projects data (typed for pyright using cast)
            raw_gh_projects: Any = context_data['github_projects']
            if isinstance(raw_gh_projects, dict):
                github_projects_data = cast(Dict[str, Any], raw_gh_projects)
                # Phase 3: Handle new structure with user_projects and org_projects
                # Try org_projects first (prioritize for org repos)
                projects_list: list[Dict[str, Any]] = []
                detected_owner_type: str | None = None
                
                # Helper to safely extract projects list from untyped data
                def extract_projects_list(raw_list: Any) -> list[Dict[str, Any]]:
                    if not isinstance(raw_list, list):
                        return []
                    result: list[Dict[str, Any]] = []
                    typed_list = cast(List[Any], raw_list)
                    for raw_item in typed_list:
                        if isinstance(raw_item, dict):
                            result.append(cast(Dict[str, Any], raw_item))
                    return result
                
                if 'org_projects' in github_projects_data and github_projects_data['org_projects']:
                    projects_list = extract_projects_list(github_projects_data['org_projects'])
                    detected_owner_type = 'org'
                elif 'user_projects' in github_projects_data and github_projects_data['user_projects']:
                    projects_list = extract_projects_list(github_projects_data['user_projects'])
                    detected_owner_type = 'user'
                # Backward compatibility: old Phase 1 structure
                elif 'github_projects' in github_projects_data:
                    projects_list = extract_projects_list(github_projects_data['github_projects'])
                
                if detected_owner_type and not project_owner_type:
                    project_owner_type = detected_owner_type
                
                if projects_list and len(projects_list) > 0:
                    # Use the first (most recent) project
                    first_project = projects_list[0]
                    if not project_number and 'number' in first_project:
                        project_number = first_project['number']
                    if not github_project_url and 'url' in first_project:
                        github_project_url = first_project['url']
                    if not project_owner and 'owner' in first_project:
                        project_owner = first_project['owner']
                    # Detect owner_type from project if not set
                    if not project_owner_type and 'source' in first_project:
                        project_owner_type = first_project['source']
        
        # Auto-populate issue info from context if not explicitly set
        if not issue_number and context_data:
            # Try to detect issue from branch name (e.g., "issue-123", "fix/issue-456", "#123")
            branch = context_data.get('branch', '')
            if branch:
                import re
                # Match patterns: issue-123, #123, /issue-123/, /123-
                patterns = [r'issue[/-]?(\d+)', r'#(\d+)', r'/(\d+)[/-]']
                for pattern in patterns:
                    match = re.search(pattern, branch, re.IGNORECASE)
                    if match:
                        issue_number = int(match.group(1))
                        break
            
            # If we found an issue number from branch and have github_issues in context, find the URL
            if issue_number and 'github_issues' in context_data:
                for issue in context_data['github_issues']:
                    if issue.get('number') == issue_number:
                        issue_url = issue.get('url')
                        break
        
        # Auto-populate PR info from context if not explicitly set
        if not pr_number and context_data and 'current_pr' in context_data:
            current_pr = context_data['current_pr']
            if current_pr:
                pr_number = current_pr.get('number')
                pr_url = current_pr.get('url')
                # Determine PR status
                if current_pr.get('merged'):
                    pr_status = 'merged'
                elif current_pr.get('draft'):
                    pr_status = 'draft'
                else:
                    pr_status = current_pr.get('state', 'open').lower()

    tag_ids = []
    if tags:
        # Run tag creation in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        tag_ids = await loop.run_in_executor(thread_pool, _db.auto_create_tags, tags)

    # Run database operations in thread pool to avoid blocking event loop
    def create_entry_in_db():
        with _db.get_connection() as conn:
            cursor = conn.execute("""
                INSERT INTO memory_journal (
                    entry_type, content, is_personal, share_with_team, project_context, related_patterns,
                    project_number, project_item_id, github_project_url,
                    issue_number, issue_url, pr_number, pr_url, pr_status,
                    workflow_run_id, workflow_name, workflow_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (entry_type, content, is_personal, 1 if share_with_team else 0, project_context, ','.join(tags),
                  project_number, project_item_id, github_project_url,
                  issue_number, issue_url, pr_number, pr_url, pr_status,
                  workflow_run_id, workflow_name, workflow_status))

            entry_id = cursor.lastrowid
            if entry_id is None:
                raise RuntimeError("Failed to get entry ID after insert")

            for tag_id in tag_ids:
                conn.execute(
                    "INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)",
                    (entry_id, tag_id)
                )
                conn.execute(
                    "UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?",
                    (tag_id,)
                )

            if significance_type:
                conn.execute("""
                    INSERT INTO significant_entries (
                        entry_id, significance_type, significance_rating
                    ) VALUES (?, ?, 0.8)
                """, (entry_id, significance_type))

            conn.commit()
            return entry_id

    # Run in thread pool to avoid blocking
    loop = asyncio.get_event_loop()
    result_entry_id: int = await loop.run_in_executor(thread_pool, create_entry_in_db)

    # Generate and store embedding for semantic search (if available)
    if vector_search and vector_search.initialized:
        try:
            await vector_search.add_entry_embedding(result_entry_id, content)
        except Exception:
            pass  # Silently fail if embedding generation fails
    
    # Copy to team database if sharing is enabled (v2.0.0 Team Collaboration)
    shared_status = ""
    if share_with_team and _team_db is not None:
        def copy_to_team_db():
            # Fetch the full entry data to copy
            with _db.get_connection() as conn:
                cursor = conn.execute("""
                    SELECT * FROM memory_journal WHERE id = ?
                """, (result_entry_id,))
                entry_row = cursor.fetchone()
                if entry_row:
                    entry_dict = dict(entry_row)
                    entry_dict['tags'] = tags
                    entry_dict['significance_type'] = significance_type
                    assert _team_db is not None
                    return _team_db.copy_entry_to_team(entry_dict)
            return False
        
        try:
            loop = asyncio.get_event_loop()
            copy_success = await loop.run_in_executor(thread_pool, copy_to_team_db)
            if copy_success:
                shared_status = "\n🔗 Entry shared with team (copied to .memory-journal-team.db)"
            else:
                shared_status = "\n⚠️ Warning: Failed to share entry with team"
        except Exception as e:
            print(f"[ERROR] Failed to copy entry to team database: {e}", file=sys.stderr)
            shared_status = f"\n⚠️ Warning: Team sharing failed: {str(e)}"

    # Build result message with all linkage info
    linkage_info: list[str] = []
    if project_number:
        linkage_info.append(f"Project #{project_number}")
    if issue_number:
        linkage_info.append(f"Issue #{issue_number}")
    if pr_number:
        pr_info = f"PR #{pr_number}"
        if pr_status:
            pr_info += f" ({pr_status})"
        linkage_info.append(pr_info)
    if workflow_run_id:
        workflow_info = f"Workflow Run #{workflow_run_id}"
        if workflow_name:
            workflow_info += f" ({workflow_name})"
        if workflow_status:
            workflow_info += f" [{workflow_status}]"
        linkage_info.append(workflow_info)
    
    result = [types.TextContent(
        type="text",
        text=f"✅ Created journal entry #{result_entry_id}\n"
             f"Type: {entry_type}\n"
             f"Personal: {is_personal}\n"
             f"Tags: {', '.join(tags) if tags else 'None'}\n"
             f"Linked to: {', '.join(linkage_info) if linkage_info else 'None'}"
             f"{shared_status}"
    )]
    return result


async def handle_create_entry_minimal(arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle minimal entry creation without context or tags."""
    if db is None:
        raise RuntimeError("Entry handlers not initialized.")
    
    # Capture for use in nested functions
    _db = db
    
    content = arguments["content"]
    
    # GitHub Projects parameters (Phase 1 - Issue #15)
    project_number = arguments.get("project_number")
    project_item_id = arguments.get("project_item_id")
    github_project_url = arguments.get("github_project_url")

    # Just a simple database insert without any context or tag operations
    def minimal_db_insert():
        with _db.get_connection() as conn:
            cursor = conn.execute("""
                INSERT INTO memory_journal (
                    entry_type, content, is_personal,
                    project_number, project_item_id, github_project_url
                ) VALUES (?, ?, ?, ?, ?, ?)
            """, ("test_entry", content, True, project_number, project_item_id, github_project_url))
            entry_id = cursor.lastrowid
            if entry_id is None:
                raise RuntimeError("Failed to get entry ID after insert")
            conn.commit()
            return entry_id

    # Run in thread pool
    loop = asyncio.get_event_loop()
    entry_id: int = await loop.run_in_executor(thread_pool, minimal_db_insert)

    return [types.TextContent(
        type="text",
        text=f"✅ Minimal entry created #{entry_id}"
    )]


async def handle_get_recent_entries(arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle getting recent journal entries."""
    if db is None:
        raise RuntimeError("Entry handlers not initialized.")
    
    # Capture for type narrowing
    _db = db
    
    limit = arguments.get("limit", 5)
    is_personal = arguments.get("is_personal")

    sql = "SELECT id, entry_type, content, timestamp, is_personal, project_context FROM memory_journal"
    params: list[Any] = []

    if is_personal is not None:
        sql += " WHERE is_personal = ?"
        params.append(is_personal)

    sql += " ORDER BY timestamp DESC LIMIT ?"
    params.append(limit)

    with _db.get_connection() as conn:
        cursor = conn.execute(sql, params)
        entries = [dict(row) for row in cursor.fetchall()]

    result = f"Recent {len(entries)} entries:\n\n"
    for entry in entries:
        result += f"#{entry['id']} ({entry['entry_type']}) - {entry['timestamp']}\n"
        result += f"Personal: {bool(entry['is_personal'])}\n"
        content_preview = entry['content'][:200] + ('...' if len(entry['content']) > 200 else '')
        result += f"Content: {content_preview}\n"

        # Add context if available
        if entry.get('project_context'):
            try:
                context = json.loads(entry['project_context'])
                if context.get('repo_name'):
                    result += f"Context: {context['repo_name']} ({context.get('branch', 'unknown branch')})\n"
            except Exception:
                pass
        result += "\n"

    return [types.TextContent(type="text", text=result)]


async def handle_get_entry_by_id(arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle getting a specific journal entry by ID with full details."""
    if db is None:
        raise RuntimeError("Entry handlers not initialized.")
    
    # Capture for use in nested functions
    _db = db
    
    entry_id = arguments.get("entry_id")
    include_relationships = arguments.get("include_relationships", True)

    if not entry_id:
        return [types.TextContent(type="text", text="❌ Entry ID is required")]

    def get_entry_details():
        with _db.get_connection() as conn:
            # Get main entry (including GitHub Projects, Issues, PRs, and Actions columns)
            cursor = conn.execute("""
                SELECT id, entry_type, content, timestamp, is_personal, project_context, related_patterns,
                       project_number, project_item_id, github_project_url,
                       issue_number, issue_url, pr_number, pr_url, pr_status,
                       workflow_run_id, workflow_name, workflow_status
                FROM memory_journal
                WHERE id = ? AND deleted_at IS NULL
            """, (entry_id,))
            entry = cursor.fetchone()
            
            if not entry:
                return None

            result = dict(entry)
            
            # Get tags
            cursor = conn.execute("""
                SELECT t.name FROM tags t
                JOIN entry_tags et ON t.id = et.tag_id
                WHERE et.entry_id = ?
            """, (entry_id,))
            result['tags'] = [row[0] for row in cursor.fetchall()]

            # Get significance
            cursor = conn.execute("""
                SELECT significance_type, significance_rating
                FROM significant_entries
                WHERE entry_id = ?
            """, (entry_id,))
            sig = cursor.fetchone()
            if sig:
                result['significance'] = dict(sig)

            # Get relationships if requested
            if include_relationships:
                cursor = conn.execute("""
                    SELECT r.to_entry_id, r.relationship_type, r.description,
                           m.content, m.entry_type
                    FROM relationships r
                    JOIN memory_journal m ON r.to_entry_id = m.id
                    WHERE r.from_entry_id = ? AND m.deleted_at IS NULL
                """, (entry_id,))
                result['relationships_to'] = [dict(row) for row in cursor.fetchall()]

                cursor = conn.execute("""
                    SELECT r.from_entry_id, r.relationship_type, r.description,
                           m.content, m.entry_type
                    FROM relationships r
                    JOIN memory_journal m ON r.from_entry_id = m.id
                    WHERE r.to_entry_id = ? AND m.deleted_at IS NULL
                """, (entry_id,))
                result['relationships_from'] = [dict(row) for row in cursor.fetchall()]

            return result

    loop = asyncio.get_event_loop()
    entry = await loop.run_in_executor(thread_pool, get_entry_details)

    if entry is None:
        return [types.TextContent(type="text", text=f"❌ Entry #{entry_id} not found")]

    # Format output
    output = f"**Entry #{entry['id']}** ({entry['entry_type']})\n"
    output += f"Timestamp: {entry['timestamp']}\n"
    output += f"Personal: {bool(entry['is_personal'])}\n\n"
    output += f"**Content:**\n{entry['content']}\n\n"
    
    if entry['tags']:
        output += f"**Tags:** {', '.join(entry['tags'])}\n\n"

    if entry.get('significance'):
        output += f"**Significance:** {entry['significance']['significance_type']} (rating: {entry['significance']['significance_rating']})\n\n"

    # Show GitHub linkage
    github_links: list[str] = []
    if entry.get('project_number'):
        github_links.append(f"Project #{entry['project_number']}")
    if entry.get('issue_number'):
        issue_link = f"Issue #{entry['issue_number']}"
        if entry.get('issue_url'):
            issue_link += f" ({entry['issue_url']})"
        github_links.append(issue_link)
    if entry.get('pr_number'):
        pr_link = f"PR #{entry['pr_number']}"
        if entry.get('pr_status'):
            pr_link += f" ({entry['pr_status']})"
        if entry.get('pr_url'):
            pr_link += f" - {entry['pr_url']}"
        github_links.append(pr_link)
    if entry.get('workflow_run_id'):
        workflow_link = f"Workflow Run #{entry['workflow_run_id']}"
        if entry.get('workflow_name'):
            workflow_link += f" ({entry['workflow_name']})"
        if entry.get('workflow_status'):
            workflow_link += f" [{entry['workflow_status']}]"
        github_links.append(workflow_link)
    
    if github_links:
        output += f"**GitHub Links:** {', '.join(github_links)}\n\n"

    if entry.get('project_context'):
        try:
            ctx = json.loads(entry['project_context'])
            if ctx.get('repo_name'):
                output += f"**Context:** {ctx['repo_name']} ({ctx.get('branch', 'unknown')})\n\n"
        except:
            pass

    if include_relationships and (entry.get('relationships_to') or entry.get('relationships_from')):
        output += "**Relationships:**\n"
        for rel in entry.get('relationships_to', []):
            output += f"  → {rel['relationship_type']}: Entry #{rel['to_entry_id']} ({rel['entry_type'][:50]}...)\n"
        for rel in entry.get('relationships_from', []):
            output += f"  ← {rel['relationship_type']}: Entry #{rel['from_entry_id']} ({rel['entry_type'][:50]}...)\n"

    return [types.TextContent(type="text", text=output)]


async def handle_update_entry(arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle updating an existing journal entry."""
    if db is None:
        raise RuntimeError("Entry handlers not initialized.")
    
    # Capture for use in nested functions
    _db = db
    
    entry_id = arguments.get("entry_id")
    content = arguments.get("content")
    entry_type = arguments.get("entry_type")
    tags = arguments.get("tags")
    is_personal = arguments.get("is_personal")

    if not entry_id:
        return [types.TextContent(type="text", text="❌ Entry ID is required")]

    def update_entry_in_db():
        with _db.get_connection() as conn:
            # Check if entry exists
            cursor = conn.execute("SELECT id FROM memory_journal WHERE id = ?", (entry_id,))
            if not cursor.fetchone():
                return None

            # Build dynamic update query
            updates: list[str] = []
            params: list[Any] = []
            
            if content is not None:
                updates.append("content = ?")
                params.append(content)
            
            if entry_type is not None:
                updates.append("entry_type = ?")
                params.append(entry_type)
            
            if is_personal is not None:
                updates.append("is_personal = ?")
                params.append(is_personal)

            if updates:
                params.append(entry_id)
                conn.execute(
                    f"UPDATE memory_journal SET {', '.join(updates)} WHERE id = ?",
                    params
                )

            # Update tags if provided
            if tags is not None:
                # Remove old tags
                conn.execute("DELETE FROM entry_tags WHERE entry_id = ?", (entry_id,))
                
                # Add new tags (using same connection to avoid locks)
                for tag_name in tags:
                    tag_cursor = conn.execute("SELECT id FROM tags WHERE name = ?", (tag_name,))
                    tag_row = tag_cursor.fetchone()
                    
                    if tag_row:
                        tag_id = tag_row[0]
                    else:
                        tag_cursor = conn.execute(
                            "INSERT INTO tags (name, usage_count) VALUES (?, 1)",
                            (tag_name,)
                        )
                        tag_id = tag_cursor.lastrowid
                    
                    conn.execute(
                        "INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)",
                        (entry_id, tag_id)
                    )
                    conn.execute(
                        "UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?",
                        (tag_id,)
                    )

            conn.commit()
            return entry_id

    loop = asyncio.get_event_loop()
    result_id = await loop.run_in_executor(thread_pool, update_entry_in_db)

    if result_id is None:
        return [types.TextContent(type="text", text=f"❌ Entry #{entry_id} not found")]

    # Update embedding if content changed and vector search is available
    if content and vector_search and vector_search.initialized:
        try:
            await vector_search.add_entry_embedding(entry_id, content)
        except Exception as e:
            print(f"Warning: Failed to update embedding: {e}", file=sys.stderr)

    return [types.TextContent(
        type="text",
        text=f"✅ Updated entry #{entry_id}\n"
             f"Updated fields: {', '.join(k for k, v in [('content', content), ('entry_type', entry_type), ('is_personal', is_personal), ('tags', tags)] if v is not None)}"
    )]


async def handle_delete_entry(arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle deleting a journal entry (soft or permanent)."""
    if db is None:
        raise RuntimeError("Entry handlers not initialized.")
    
    # Capture for use in nested functions
    _db = db
    
    entry_id = arguments.get("entry_id")
    permanent = arguments.get("permanent", False)

    if not entry_id:
        return [types.TextContent(type="text", text="❌ Entry ID is required")]

    def delete_entry_in_db():
        with _db.get_connection() as conn:
            # Check if entry exists
            cursor = conn.execute("SELECT id FROM memory_journal WHERE id = ?", (entry_id,))
            if not cursor.fetchone():
                return None

            if permanent:
                # Permanent delete - remove from all tables
                conn.execute("DELETE FROM entry_tags WHERE entry_id = ?", (entry_id,))
                conn.execute("DELETE FROM significant_entries WHERE entry_id = ?", (entry_id,))
                conn.execute("DELETE FROM relationships WHERE from_entry_id = ? OR to_entry_id = ?", 
                           (entry_id, entry_id))
                conn.execute("DELETE FROM memory_journal WHERE id = ?", (entry_id,))
            else:
                # Soft delete - add deleted_at timestamp
                conn.execute(
                    "UPDATE memory_journal SET deleted_at = ? WHERE id = ?",
                    (datetime.now().isoformat(), entry_id)
                )

            conn.commit()
            return entry_id

    loop = asyncio.get_event_loop()
    result_id = await loop.run_in_executor(thread_pool, delete_entry_in_db)

    if result_id is None:
        return [types.TextContent(type="text", text=f"❌ Entry #{entry_id} not found")]

    delete_type = "permanently deleted" if permanent else "soft deleted"
    return [types.TextContent(
        type="text",
        text=f"✅ Entry #{entry_id} {delete_type}"
    )]


async def handle_list_tags(arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle listing all available tags."""
    if db is None:
        raise RuntimeError("Entry handlers not initialized.")
    
    with db.get_connection() as conn:
        cursor = conn.execute(
            "SELECT name, category, usage_count FROM tags ORDER BY usage_count DESC, name"
        )
        tags = [dict(row) for row in cursor.fetchall()]

    result = f"Available tags ({len(tags)}):\n\n"
    for tag in tags:
        result += f"• {tag['name']}"
        if tag['category']:
            result += f" ({tag['category']})"
        result += f" - used {tag['usage_count']} times\n"

    return [types.TextContent(type="text", text=result)]


async def handle_test_simple(arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle simple test tool."""
    message = arguments.get("message", "Hello")
    return [types.TextContent(
        type="text",
        text=f"✅ Simple test successful! Message: {message}"
    )]

