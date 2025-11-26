"""
Memory Journal MCP Server - Pull Request Workflow Prompt Handlers
Handlers for PR summaries, code review preparation, and PR retrospectives.
Phase 3: GitHub Issues & PRs Integration
"""

import asyncio
from typing import Any, Dict, List, Optional
from concurrent.futures import ThreadPoolExecutor

from mcp.types import GetPromptResult, PromptMessage, TextContent

from database.base import MemoryJournalDB
from database.context import ProjectContextManager
from github.integration import GitHubProjectsIntegration

# Global instances (initialized by main server)
db: Optional[MemoryJournalDB] = None
project_context_manager: Optional[ProjectContextManager] = None
github_projects: Optional[GitHubProjectsIntegration] = None
thread_pool: Optional[ThreadPoolExecutor] = None


def initialize_pr_prompts(db_instance: MemoryJournalDB,
                          context_manager: ProjectContextManager,
                          github_instance: GitHubProjectsIntegration,
                          pool: ThreadPoolExecutor):
    """Initialize PR workflow prompt handlers."""
    global db, project_context_manager, github_projects, thread_pool
    db = db_instance
    project_context_manager = context_manager
    github_projects = github_instance
    thread_pool = pool


async def handle_pr_summary(arguments: Dict[str, str]) -> GetPromptResult:
    """
    Generate comprehensive summary of journal activity for a specific Pull Request.
    
    Args:
        pr_number: PR number to summarize (required)
        include_commits: Include commit details - "true" or "false" (optional, default: "false")
    
    Returns:
        GetPromptResult with formatted PR summary
    """
    if db is None or project_context_manager is None or github_projects is None or thread_pool is None:
        raise RuntimeError("PR prompt handlers not initialized.")
    
    # Capture for use in nested functions
    _db = db
    _pcm = project_context_manager
    _github_projects = github_projects
    
    pr_number_str = arguments.get("pr_number")
    include_commits = arguments.get("include_commits", "false").lower() == "true"
    
    if not pr_number_str:
        return GetPromptResult(
            messages=[PromptMessage(
                role="user",
                content=TextContent(type="text", text="Error: pr_number is required")
            )]
        )
    
    try:
        pr_number = int(pr_number_str)
    except ValueError:
        return GetPromptResult(
            messages=[PromptMessage(
                role="user",
                content=TextContent(type="text", text="Error: pr_number must be a valid integer")
            )]
        )
    
    def get_pr_journal_data():
        """Get journal entries for this PR."""
        with _db.get_connection() as conn:
            # Get all entries for this PR
            cursor = conn.execute("""
                SELECT id, entry_type, content, timestamp, pr_status, 
                       issue_number, project_context
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
    entries = await loop.run_in_executor(thread_pool, get_pr_journal_data)
    
    # Get PR details from GitHub
    pr_details = None
    owner = None
    repo = None
    
    # Extract owner/repo from first entry's context
    if entries and entries[0].get('project_context'):
        from github.api import extract_repo_info_from_context
        owner, repo = extract_repo_info_from_context(entries[0]['project_context'])
    
    # If not found, get from current context
    if not owner or not repo:
        project_context = await _pcm.get_project_context()
        if 'repo_path' in project_context:
            owner = _github_projects.extract_repo_owner_from_remote(project_context['repo_path'])
            repo = project_context.get('repo_name')
    
    # Fetch PR details from GitHub
    if owner and repo and _github_projects.github_token:
        from github.api import get_pr_details
        try:
            pr_details = get_pr_details(github_projects, owner, repo, pr_number)
        except Exception:
            pass  # Continue without GitHub data
    
    # Build summary
    summary = f"# Pull Request #{pr_number} Summary\n\n"
    
    # PR Header
    if pr_details:
        summary += f"## Pull Request Information\n\n"
        summary += f"**Title:** {pr_details.get('title', 'Unknown')}  \n"
        summary += f"**Author:** {pr_details.get('author', 'Unknown')}  \n"
        summary += f"**Status:** {pr_details.get('state', 'unknown')}"
        if pr_details.get('draft'):
            summary += " (draft)"
        if pr_details.get('merged'):
            summary += " - merged"
        summary += "  \n"
        summary += f"**Created:** {pr_details.get('created_at', 'Unknown')[:10]}  \n"
        if pr_details.get('merged_at'):
            summary += f"**Merged:** {pr_details['merged_at'][:10]}  \n"
        if pr_details.get('closed_at') and not pr_details.get('merged'):
            summary += f"**Closed:** {pr_details['closed_at'][:10]}  \n"
        summary += f"**Branch:** {pr_details.get('head_branch', 'unknown')} → {pr_details.get('base_branch', 'main')}  \n"
        
        # Linked issues
        if pr_details.get('linked_issues'):
            summary += f"**Linked Issues:** #{', #'.join(str(i) for i in pr_details['linked_issues'])}  \n"
        
        # Stats
        if pr_details.get('commits_count'):
            summary += f"\n**Changes:**  \n"
            summary += f"- Commits: {pr_details['commits_count']}  \n"
            summary += f"- Files changed: {pr_details.get('changed_files', 0)}  \n"
            summary += f"- Additions: +{pr_details.get('additions', 0)}  \n"
            summary += f"- Deletions: -{pr_details.get('deletions', 0)}  \n"
        
        if pr_details.get('reviewers'):
            summary += f"**Reviewers:** {', '.join(pr_details['reviewers'])}  \n"
        
        if pr_details.get('url'):
            summary += f"\n[View on GitHub]({pr_details['url']})\n"
        
        summary += "\n"
    else:
        summary += f"*GitHub PR details not available*\n\n"
    
    # Journal Activity Summary
    summary += f"## Journal Activity\n\n"
    if entries:
        entry_count = len(entries)
        first_date = entries[0]['timestamp'][:10]
        last_date = entries[-1]['timestamp'][:10]
        
        summary += f"**Entries:** {entry_count}  \n"
        summary += f"**Date Range:** {first_date} to {last_date}  \n"
        
        # Collect all tags
        all_tags: set[str] = set()
        for entry in entries:
            tags_list: List[str] = entry.get('tags', [])
            all_tags.update(tags_list)
        
        if all_tags:
            summary += f"**Key Tags:** {', '.join(sorted(all_tags))}  \n"
        
        summary += "\n"
        
        # Entries grouped by date
        summary += "### Journal Entries\n\n"
        current_date = None
        for entry in entries:
            entry_date = entry['timestamp'][:10]
            if entry_date != current_date:
                summary += f"\n**{entry_date}**\n\n"
                current_date = entry_date
            
            summary += f"- **Entry #{entry['id']}** ({entry['entry_type']}) - {entry['timestamp'][11:16]}\n"
            
            # Content preview (first 150 chars)
            content_preview = entry['content'][:150]
            if len(entry['content']) > 150:
                content_preview += "..."
            summary += f"  {content_preview}\n"
            
            if entry.get('tags'):
                summary += f"  *Tags: {', '.join(entry['tags'])}*\n"
            
            summary += "\n"
    else:
        summary += "*No journal entries found for this PR*\n\n"
    
    # Commit summary (if requested and available)
    if include_commits and pr_details and pr_details.get('commits_count'):
        summary += f"## Commits\n\n"
        summary += f"Total commits: {pr_details['commits_count']}\n\n"
        summary += "*Note: Detailed commit information requires GitHub API enhancement*\n\n"
    
    # Review summary
    if pr_details:
        summary += f"## Review Activity\n\n"
        if pr_details.get('comments_count') or pr_details.get('review_comments_count'):
            summary += f"- Comments: {pr_details.get('comments_count', 0)}  \n"
            summary += f"- Review comments: {pr_details.get('review_comments_count', 0)}  \n"
        else:
            summary += "*No review activity recorded*\n"
    
    return GetPromptResult(
        messages=[PromptMessage(
            role="user",
            content=TextContent(type="text", text=summary)
        )]
    )


async def handle_code_review_prep(arguments: Dict[str, str]) -> GetPromptResult:
    """
    Prepare for code review by gathering PR context, linked issues, and related journal entries.
    
    Args:
        pr_number: PR number to review (required)
        author: PR author username (optional)
    
    Returns:
        GetPromptResult with comprehensive review preparation document
    """
    if db is None or project_context_manager is None or github_projects is None or thread_pool is None:
        raise RuntimeError("PR prompt handlers not initialized.")
    
    # Capture for use in nested functions
    _db = db
    _pcm = project_context_manager
    _github_projects = github_projects
    
    pr_number_str = arguments.get("pr_number")
    author_filter = arguments.get("author")
    
    if not pr_number_str:
        return GetPromptResult(
            messages=[PromptMessage(
                role="user",
                content=TextContent(type="text", text="Error: pr_number is required")
            )]
        )
    
    try:
        pr_number = int(pr_number_str)
    except ValueError:
        return GetPromptResult(
            messages=[PromptMessage(
                role="user",
                content=TextContent(type="text", text="Error: pr_number must be a valid integer")
            )]
        )
    
    def get_pr_context_data() -> tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[int]]:
        """Get journal entries for PR and linked issues."""
        with _db.get_connection() as conn:
            # Get PR entries
            cursor = conn.execute("""
                SELECT id, entry_type, content, timestamp, issue_number, project_context
                FROM memory_journal
                WHERE pr_number = ? AND deleted_at IS NULL
                ORDER BY timestamp ASC
            """, (pr_number,))
            pr_entries = [dict(row) for row in cursor.fetchall()]
            
            # Get tags for PR entries
            for entry in pr_entries:
                cursor = conn.execute("""
                    SELECT t.name FROM tags t
                    JOIN entry_tags et ON t.id = et.tag_id
                    WHERE et.entry_id = ?
                """, (entry['id'],))
                entry['tags'] = [row[0] for row in cursor.fetchall()]
            
            # Collect linked issues from entries
            linked_issues_from_entries: set[int] = set()
            for entry in pr_entries:
                issue_num: int | None = entry.get('issue_number')
                if issue_num is not None:
                    linked_issues_from_entries.add(issue_num)
            
            # Get issue entries if any issues are linked
            issue_entries: List[Dict[str, Any]] = []
            if linked_issues_from_entries:
                placeholders = ','.join('?' * len(linked_issues_from_entries))
                cursor = conn.execute(f"""
                    SELECT id, entry_type, content, timestamp, issue_number
                    FROM memory_journal
                    WHERE issue_number IN ({placeholders}) AND deleted_at IS NULL
                    ORDER BY timestamp ASC
                """, tuple(linked_issues_from_entries))
                issue_entries = [dict(row) for row in cursor.fetchall()]
                
                # Get tags for issue entries
                for entry in issue_entries:
                    cursor = conn.execute("""
                        SELECT t.name FROM tags t
                        JOIN entry_tags et ON t.id = et.tag_id
                        WHERE et.entry_id = ?
                    """, (entry['id'],))
                    entry['tags'] = [row[0] for row in cursor.fetchall()]
            
            return pr_entries, issue_entries, list(linked_issues_from_entries)
    
    loop = asyncio.get_event_loop()
    pr_entries, issue_entries, linked_issue_numbers = await loop.run_in_executor(thread_pool, get_pr_context_data)
    
    # Get PR details from GitHub
    pr_details = None
    owner = None
    repo = None
    
    # Extract owner/repo from first entry's context
    if pr_entries and pr_entries[0].get('project_context'):
        from github.api import extract_repo_info_from_context
        owner, repo = extract_repo_info_from_context(pr_entries[0]['project_context'])
    
    # If not found, get from current context
    if not owner or not repo:
        project_context = await _pcm.get_project_context()
        if 'repo_path' in project_context:
            owner = _github_projects.extract_repo_owner_from_remote(project_context['repo_path'])
            repo = project_context.get('repo_name')
    
    # Fetch PR details from GitHub
    if owner and repo and _github_projects.github_token:
        from github.api import get_pr_details
        try:
            pr_details = get_pr_details(github_projects, owner, repo, pr_number)
            # Add GitHub-detected linked issues
            if pr_details and pr_details.get('linked_issues'):
                linked_issue_numbers.extend(pr_details['linked_issues'])
                linked_issue_numbers = list(set(linked_issue_numbers))  # Dedupe
        except Exception:
            pass
    
    # Filter by author if specified
    if author_filter and pr_details:
        if pr_details.get('author', '').lower() != author_filter.lower():
            return GetPromptResult(
                messages=[PromptMessage(
                    role="user",
                    content=TextContent(type="text", text=f"Error: PR #{pr_number} author does not match '{author_filter}'")
                )]
            )
    
    # Build review prep document
    prep = f"# Code Review Preparation - PR #{pr_number}\n\n"
    
    # PR Overview
    prep += "## Pull Request Overview\n\n"
    if pr_details:
        prep += f"**Title:** {pr_details.get('title', 'Unknown')}  \n"
        prep += f"**Author:** {pr_details.get('author', 'Unknown')}  \n"
        prep += f"**Status:** {pr_details.get('state', 'unknown')}"
        if pr_details.get('draft'):
            prep += " (draft)"
        prep += "  \n"
        prep += f"**Branch:** {pr_details.get('head_branch', 'unknown')} → {pr_details.get('base_branch', 'main')}  \n"
        
        # Description
        if pr_details.get('body'):
            prep += f"\n**Description:**  \n"
            body_preview = pr_details['body'][:300]
            if len(pr_details['body']) > 300:
                body_preview += "..."
            prep += f"{body_preview}\n\n"
        
        # Stats
        prep += f"\n**Change Summary:**  \n"
        prep += f"- {pr_details.get('commits_count', 0)} commits  \n"
        prep += f"- {pr_details.get('changed_files', 0)} files changed  \n"
        prep += f"- +{pr_details.get('additions', 0)} / -{pr_details.get('deletions', 0)} lines  \n\n"
        
        if pr_details.get('url'):
            prep += f"[View on GitHub]({pr_details['url']})\n\n"
    else:
        prep += "*GitHub PR details not available*\n\n"
    
    # Context Section
    prep += "## Context & Background\n\n"
    
    # Linked issues
    if linked_issue_numbers:
        prep += f"### Linked Issues\n\n"
        for issue_num in sorted(linked_issue_numbers):
            prep += f"- Issue #{issue_num}\n"
        prep += "\n"
        
        # Show issue-related journal entries
        if issue_entries:
            prep += f"### Background from Issue Work\n\n"
            for entry in issue_entries[:5]:  # Limit to 5 most relevant
                prep += f"**Issue #{entry['issue_number']} - Entry #{entry['id']}** ({entry['entry_type']})  \n"
                content_preview = entry['content'][:150]
                if len(entry['content']) > 150:
                    content_preview += "..."
                prep += f"{content_preview}\n\n"
    
    # PR development journal
    if pr_entries:
        prep += f"### Development Notes from Author\n\n"
        for entry in pr_entries:
            prep += f"**{entry['timestamp'][:10]}** - Entry #{entry['id']} ({entry['entry_type']})  \n"
            content_preview = entry['content'][:200]
            if len(entry['content']) > 200:
                content_preview += "..."
            prep += f"{content_preview}\n\n"
    else:
        prep += "*No journal entries found for this PR*\n\n"
    
    # Key Changes
    if pr_details and pr_details.get('changed_files'):
        prep += "## Key Changes\n\n"
        prep += f"This PR modifies {pr_details['changed_files']} file(s).\n\n"
        prep += "*Detailed file changes available on GitHub*\n\n"
    
    # Questions to Ask
    prep += "## Review Questions\n\n"
    
    # Auto-generate questions based on context
    questions: List[str] = []
    
    if pr_details and pr_details.get('draft'):
        questions.append("Why is this PR still in draft status?")
    
    if linked_issue_numbers:
        questions.append(f"How does this PR address issue(s) #{', #'.join(str(i) for i in sorted(linked_issue_numbers))}?")
    
    if pr_details and pr_details.get('changed_files', 0) > 20:
        questions.append("This is a large PR - can it be broken into smaller chunks?")
    
    if not pr_entries:
        questions.append("Are there any development notes or context not captured in journal entries?")
    
    # Add generic questions
    questions.extend([
        "Are there any edge cases or error scenarios to consider?",
        "What testing has been done?",
        "Are there any performance implications?",
        "Is the code maintainable and well-documented?"
    ])
    
    for i, question in enumerate(questions, 1):
        prep += f"{i}. {question}\n"
    
    return GetPromptResult(
        messages=[PromptMessage(
            role="user",
            content=TextContent(type="text", text=prep)
        )]
    )


async def handle_pr_retrospective(arguments: Dict[str, str]) -> GetPromptResult:
    """
    Analyze completed PR for learnings, metrics, and insights from journal entries.
    
    Args:
        pr_number: Completed PR number (required)
        include_metrics: Include time metrics - "true" or "false" (optional, default: "true")
    
    Returns:
        GetPromptResult with retrospective analysis
    """
    if db is None or project_context_manager is None or github_projects is None or thread_pool is None:
        raise RuntimeError("PR prompt handlers not initialized.")
    
    # Capture for use in nested functions
    _db = db
    _pcm = project_context_manager
    _github_projects = github_projects
    
    pr_number_str = arguments.get("pr_number")
    include_metrics = arguments.get("include_metrics", "true").lower() == "true"
    
    if not pr_number_str:
        return GetPromptResult(
            messages=[PromptMessage(
                role="user",
                content=TextContent(type="text", text="Error: pr_number is required")
            )]
        )
    
    try:
        pr_number = int(pr_number_str)
    except ValueError:
        return GetPromptResult(
            messages=[PromptMessage(
                role="user",
                content=TextContent(type="text", text="Error: pr_number must be a valid integer")
            )]
        )
    
    def get_pr_retro_data():
        """Get journal entries for retrospective analysis."""
        with _db.get_connection() as conn:
            # Get all entries for this PR
            cursor = conn.execute("""
                SELECT id, entry_type, content, timestamp, pr_status, project_context
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
    entries = await loop.run_in_executor(thread_pool, get_pr_retro_data)
    
    # Get PR details from GitHub
    pr_details = None
    owner = None
    repo = None
    
    # Extract owner/repo from first entry's context
    if entries and entries[0].get('project_context'):
        from github.api import extract_repo_info_from_context
        owner, repo = extract_repo_info_from_context(entries[0]['project_context'])
    
    # If not found, get from current context
    if not owner or not repo:
        project_context = await _pcm.get_project_context()
        if 'repo_path' in project_context:
            owner = _github_projects.extract_repo_owner_from_remote(project_context['repo_path'])
            repo = project_context.get('repo_name')
    
    # Fetch PR details from GitHub
    if owner and repo and _github_projects.github_token:
        from github.api import get_pr_details
        try:
            pr_details = get_pr_details(github_projects, owner, repo, pr_number)
        except Exception:
            pass
    
    # Verify PR is completed
    if pr_details and pr_details.get('state') == 'open':
        return GetPromptResult(
            messages=[PromptMessage(
                role="user",
                content=TextContent(type="text", text=f"Warning: PR #{pr_number} is still open (not merged or closed). Retrospective is best for completed PRs.")
            )]
        )
    
    # Build retrospective
    retro = f"# Pull Request #{pr_number} Retrospective\n\n"
    
    # PR Summary
    retro += "## PR Summary\n\n"
    if pr_details:
        retro += f"**Title:** {pr_details.get('title', 'Unknown')}  \n"
        retro += f"**Author:** {pr_details.get('author', 'Unknown')}  \n"
        retro += f"**Status:** "
        if pr_details.get('merged'):
            retro += f"✅ Merged on {pr_details.get('merged_at', 'unknown')[:10]}\n"
        elif pr_details.get('state') == 'closed':
            retro += f"❌ Closed without merge on {pr_details.get('closed_at', 'unknown')[:10]}\n"
        else:
            retro += f"{pr_details.get('state', 'unknown')}\n"
        
        retro += f"**Changes:** {pr_details.get('changed_files', 0)} files, "
        retro += f"+{pr_details.get('additions', 0)} / -{pr_details.get('deletions', 0)} lines  \n"
        
        if pr_details.get('url'):
            retro += f"\n[View on GitHub]({pr_details['url']})\n"
        
        retro += "\n"
    
    # Timeline
    retro += "## Timeline\n\n"
    if entries:
        first_entry_date = entries[0]['timestamp'][:10]
        last_entry_date = entries[-1]['timestamp'][:10]
        retro += f"- **First journal entry:** {first_entry_date}\n"
        retro += f"- **Last journal entry:** {last_entry_date}\n"
    
    if pr_details:
        if pr_details.get('created_at'):
            retro += f"- **PR created:** {pr_details['created_at'][:10]}\n"
        if pr_details.get('merged_at'):
            retro += f"- **PR merged:** {pr_details['merged_at'][:10]}\n"
        elif pr_details.get('closed_at'):
            retro += f"- **PR closed:** {pr_details['closed_at'][:10]}\n"
    
    retro += "\n"
    
    # Metrics
    if include_metrics and pr_details:
        retro += "## Metrics\n\n"
        
        # Time to merge/close
        if pr_details.get('created_at'):
            from datetime import datetime
            created = datetime.fromisoformat(pr_details['created_at'].replace('Z', '+00:00'))
            
            if pr_details.get('merged_at'):
                merged = datetime.fromisoformat(pr_details['merged_at'].replace('Z', '+00:00'))
                days = (merged - created).days
                retro += f"- **Time to merge:** {days} day(s)\n"
            elif pr_details.get('closed_at'):
                closed = datetime.fromisoformat(pr_details['closed_at'].replace('Z', '+00:00'))
                days = (closed - created).days
                retro += f"- **Time to close:** {days} day(s)\n"
        
        # Development activity
        if entries:
            retro += f"- **Journal entries:** {len(entries)}\n"
            active_days = len(set(e['timestamp'][:10] for e in entries))
            retro += f"- **Active days (journaled):** {active_days}\n"
        
        # Review activity
        if pr_details.get('comments_count') or pr_details.get('review_comments_count'):
            total_comments = pr_details.get('comments_count', 0) + pr_details.get('review_comments_count', 0)
            retro += f"- **Total review comments:** {total_comments}\n"
        
        retro += "\n"
    
    # What went well
    retro += "## What Went Well ✅\n\n"
    
    positive_indicators: List[str] = []
    if pr_details and pr_details.get('merged'):
        positive_indicators.append("PR was successfully merged")
    
    # Look for achievement/success entries
    achievement_entries = [e for e in entries if 'achievement' in e.get('entry_type', '').lower() or 'success' in e.get('content', '').lower()]
    if achievement_entries:
        positive_indicators.append(f"Documented {len(achievement_entries)} achievement(s) during development")
        for entry in achievement_entries[:3]:  # Show top 3
            content_preview = entry['content'][:100]
            if len(entry['content']) > 100:
                content_preview += "..."
            positive_indicators.append(f"  - {content_preview}")
    
    if positive_indicators:
        for indicator in positive_indicators:
            retro += f"- {indicator}\n"
    else:
        retro += "*No specific positive indicators found in journal entries*\n"
    
    retro += "\n"
    
    # Challenges
    retro += "## Challenges Faced 🚧\n\n"
    
    # Look for problem/blocker entries
    challenge_keywords = ['bug', 'issue', 'problem', 'blocker', 'challenge', 'difficult', 'stuck']
    challenge_entries: List[Dict[str, Any]] = []
    for entry in entries:
        content_lower = entry.get('content', '').lower()
        if any(keyword in content_lower for keyword in challenge_keywords):
            challenge_entries.append(entry)
    
    if challenge_entries:
        for entry in challenge_entries[:5]:  # Show top 5 challenges
            retro += f"- **{entry['timestamp'][:10]}:** "
            content_preview = entry['content'][:150]
            if len(entry['content']) > 150:
                content_preview += "..."
            retro += f"{content_preview}\n"
    else:
        retro += "*No specific challenges documented in journal entries*\n"
    
    retro += "\n"
    
    # Key learnings
    retro += "## Key Learnings 💡\n\n"
    
    # Look for learning/insight entries
    learning_keywords = ['learned', 'discovered', 'insight', 'realized', 'understanding', 'found that']
    learning_entries: List[Dict[str, Any]] = []
    for entry in entries:
        content_lower = entry.get('content', '').lower()
        if any(keyword in content_lower for keyword in learning_keywords):
            learning_entries.append(entry)
    
    if learning_entries:
        for entry in learning_entries[:5]:  # Show top 5 learnings
            retro += f"- **{entry['timestamp'][:10]}:** "
            content_preview = entry['content'][:150]
            if len(entry['content']) > 150:
                content_preview += "..."
            retro += f"{content_preview}\n"
    else:
        retro += "*No specific learnings documented in journal entries*\n"
    
    retro += "\n"
    
    # Tag analysis
    if entries:
        all_tags: List[str] = []
        for entry in entries:
            entry_tags: List[str] = entry.get('tags', [])
            all_tags.extend(entry_tags)
        
        if all_tags:
            from collections import Counter
            tag_counts = Counter(all_tags)
            top_tags = tag_counts.most_common(5)
            
            retro += "## Focus Areas (by tags)\n\n"
            for tag, count in top_tags:
                retro += f"- **{tag}:** {count} mention(s)\n"
            retro += "\n"
    
    # Linked work
    if pr_details and pr_details.get('linked_issues'):
        retro += "## Related Work\n\n"
        retro += f"This PR addressed issue(s): #{', #'.join(str(i) for i in pr_details['linked_issues'])}\n\n"
    
    return GetPromptResult(
        messages=[PromptMessage(
            role="user",
            content=TextContent(type="text", text=retro)
        )]
    )

