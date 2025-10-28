"""
Memory Journal MCP Server - Utility Functions
Common utility functions used throughout the application.
"""

from typing import Optional
from datetime import datetime, timedelta


def escape_fts5_query(query: str) -> str:
    """
    Escape FTS5 special characters for safe querying.
    
    FTS5 special chars: + - " * ( ) : . AND OR NOT
    If query contains special chars, wrap individual terms in quotes.
    
    Args:
        query: The search query to escape
        
    Returns:
        Escaped query safe for FTS5 matching
    """
    # Check if query contains FTS5 operators or special chars
    special_chars = ['-', '+', '*', '(', ')', '"', '.', ':']
    has_special = any(char in query for char in special_chars)
    
    if has_special:
        # For queries with special chars, we need to escape them within quotes
        # Replace double quotes with escaped quotes
        escaped = query.replace('"', '""')
        # Wrap the entire query in quotes for literal matching
        return f'"{escaped}"'
    else:
        # No special chars, return as-is for natural FTS5 matching
        return query


def truncate_content(content: str, max_length: int, suffix: str = '...') -> str:
    """
    Truncate content to a maximum length with optional suffix.
    
    Args:
        content: The content to truncate
        max_length: Maximum length before truncation
        suffix: Suffix to add if truncated (default: '...')
        
    Returns:
        Truncated content with suffix if needed
    """
    if len(content) <= max_length:
        return content
    return content[:max_length] + suffix


def sanitize_mermaid_text(text: str) -> str:
    """
    Sanitize text for use in Mermaid diagrams.
    
    Replaces characters that can break Mermaid syntax with safe alternatives.
    
    Args:
        text: Text to sanitize
        
    Returns:
        Sanitized text safe for Mermaid diagrams
    """
    # Replace problematic characters
    sanitized = text.replace('\n', ' ')
    sanitized = sanitized.replace('"', "'")
    sanitized = sanitized.replace('[', '(')
    sanitized = sanitized.replace(']', ')')
    return sanitized


def format_date_range(start_date: Optional[str], end_date: Optional[str]) -> str:
    """
    Format a date range for display.
    
    Args:
        start_date: Start date (YYYY-MM-DD) or None
        end_date: End date (YYYY-MM-DD) or None
        
    Returns:
        Formatted date range string
    """
    if start_date and end_date:
        return f"{start_date} to {end_date}"
    elif start_date:
        return f"from {start_date}"
    elif end_date:
        return f"until {end_date}"
    else:
        return "all time"


def calculate_date_offset(days: int = 0, weeks: int = 0, months: int = 0) -> str:
    """
    Calculate a date offset from now and return as ISO format string.
    
    Args:
        days: Number of days to offset (negative for past)
        weeks: Number of weeks to offset (negative for past)
        months: Number of months to offset (negative for past, approximate as 30 days)
        
    Returns:
        ISO formatted date string (YYYY-MM-DD)
    """
    offset_days = days + (weeks * 7) + (months * 30)
    target_date = datetime.now() + timedelta(days=offset_days)
    return target_date.strftime('%Y-%m-%d')


def parse_week_label(week_offset: int) -> str:
    """
    Generate a human-readable week label from an offset.
    
    Args:
        week_offset: Week offset (0 = current week, -1 = last week, etc.)
        
    Returns:
        Human-readable week label
    """
    if week_offset == 0:
        return "This Week"
    elif week_offset == -1:
        return "Last Week"
    elif week_offset < 0:
        return f"{abs(week_offset)} Weeks Ago"
    else:
        return f"{week_offset} Weeks from Now"


def format_timestamp_short(timestamp: str) -> str:
    """
    Extract short time (HH:MM) from ISO timestamp.
    
    Args:
        timestamp: ISO format timestamp string
        
    Returns:
        Short time format (HH:MM)
    """
    if len(timestamp) >= 16:
        return timestamp[11:16]
    return timestamp


def format_date_short(timestamp: str) -> str:
    """
    Extract date (YYYY-MM-DD) from ISO timestamp.
    
    Args:
        timestamp: ISO format timestamp string
        
    Returns:
        Date format (YYYY-MM-DD)
    """
    return timestamp[:10]


def calculate_percentage(part: int, total: int, decimals: int = 1) -> float:
    """
    Calculate percentage with safe division.
    
    Args:
        part: The part value
        total: The total value
        decimals: Number of decimal places (default: 1)
        
    Returns:
        Percentage value (0-100)
    """
    if total == 0:
        return 0.0
    percentage = (part / total) * 100
    return round(percentage, decimals)


def format_count(count: int, singular: str, plural: Optional[str] = None) -> str:
    """
    Format a count with proper singular/plural noun.
    
    Args:
        count: The count value
        singular: Singular form of the noun
        plural: Plural form (if None, adds 's' to singular)
        
    Returns:
        Formatted string with count and noun
    """
    if count == 1:
        return f"1 {singular}"
    plural_form = plural if plural is not None else f"{singular}s"
    return f"{count} {plural_form}"


def extract_repo_name_from_path(repo_path: str) -> str:
    """
    Extract repository name from a repository path.
    
    Args:
        repo_path: Full path to repository
        
    Returns:
        Repository name (last component of path)
    """
    import os
    return os.path.basename(repo_path)


def generate_progress_bar(current: int, total: int, width: int = 20, fill_char: str = '█', empty_char: str = '░') -> str:
    """
    Generate a simple text-based progress bar.
    
    Args:
        current: Current progress value
        total: Total/maximum value
        width: Width of the progress bar in characters
        fill_char: Character for filled portion
        empty_char: Character for empty portion
        
    Returns:
        Progress bar string
    """
    if total == 0:
        return empty_char * width
    
    filled = int((current / total) * width)
    filled = min(filled, width)  # Cap at width
    empty = width - filled
    
    return (fill_char * filled) + (empty_char * empty)


def validate_date_format(date_str: str) -> bool:
    """
    Validate if a string is in YYYY-MM-DD format.
    
    Args:
        date_str: Date string to validate
        
    Returns:
        True if valid format, False otherwise
    """
    try:
        datetime.strptime(date_str, '%Y-%m-%d')
        return True
    except (ValueError, TypeError):
        return False


def normalize_owner_type(owner_type: str) -> str:
    """
    Normalize owner type to 'user' or 'org'.
    
    Args:
        owner_type: Raw owner type string
        
    Returns:
        Normalized owner type ('user' or 'org')
    """
    if owner_type and owner_type.lower() in ['org', 'organization']:
        return 'org'
    return 'user'


def build_placeholders(count: int) -> str:
    """
    Build SQL placeholder string for parameterized queries.
    
    Args:
        count: Number of placeholders needed
        
    Returns:
        Comma-separated placeholder string (e.g., "?, ?, ?")
    """
    return ','.join(['?'] * count)

