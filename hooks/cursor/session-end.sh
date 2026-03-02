#!/bin/bash

# session-end.sh — Fire-and-forget sessionEnd hook for memory-journal-mcp
#
# Cursor's sessionEnd hook is observational only (output is not used).
# Session summary creation is handled by the Cursor rule + server instructions,
# not this hook. Customize this script for logging or cleanup.
#
# Input (JSON via stdin): session_id, reason, duration_ms, is_background_agent, etc.

input=$(cat)

timestamp=$(date '+%Y-%m-%d %H:%M:%S')
session_id=$(echo "$input" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
reason=$(echo "$input" | grep -o '"reason":"[^"]*"' | head -1 | cut -d'"' -f4)

echo "[$timestamp] session=$session_id reason=$reason" >> /tmp/memory-journal-sessions.log 2>/dev/null

exit 0
