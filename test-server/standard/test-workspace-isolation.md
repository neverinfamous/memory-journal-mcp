# Workspace Isolation Test
> Run this against a clean database instance.

## Phase 1: Workspace Initialization
1. Create an entry in workspace "alpha": "Initial research on neural networks for NLP."
2. Create an entry in workspace "beta": "Quarterly financial projections for Q3."

## Phase 2: Recent Entries Isolation
1. Get recent entries for workspace "alpha". Verify only the NLP research is returned.
2. Get recent entries for workspace "beta". Verify only the financial projections are returned.

## Phase 3: Search Isolation
1. Search entries for "research" in workspace "alpha". Verify the entry is found.
2. Search entries for "research" in workspace "beta". Verify the entry is NOT found.

## Phase 4: Date Range Search Isolation
1. Search by date range (from 1 month ago to today) in workspace "alpha". Verify only the alpha entry is returned.
2. Search by date range in workspace "beta". Verify only the beta entry is returned.

## Phase 5: Statistics Isolation
1. Get statistics for workspace "alpha". Total entries should be 1.
2. Get statistics for workspace "beta". Total entries should be 1.

## Phase 6: Cross-Workspace Search
1. Search entries with `workspace_id` parameter omitted (or using special wildcard logic if applicable to the server, though usually omission means default). *Note: The server uses default workspace if omitted, so this should only return entries in the 'default' workspace unless specifically queried.*

## Phase 7: Moving Entries
1. Update the alpha entry (the NLP research), setting its `workspace_id` to "beta".
2. Get recent entries for workspace "alpha" — it should now be empty.
3. Get recent entries for workspace "beta" — it should now contain both entries.

## Phase 8: Team Database Isolation
1. Switch to team operations (if applicable).
2. Perform similar operations using team tools (e.g., `team_create_entry`) using workspaces "alpha" and "beta" to ensure team data is also isolated correctly.
