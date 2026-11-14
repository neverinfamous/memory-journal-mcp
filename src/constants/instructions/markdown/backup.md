# Backup Operations
- **Snapshots**: `backup_journal({ name? })` creates an on-demand SQLite snapshot of the personal journal database before destructive maintenance (use `team_backup` for the shared team database).
- **Listing & Restore**: `list_backups()` lists available snapshots; `restore_backup({ filename, confirm: true })` automatically takes a `pre_restore_*` safety backup first, restores the database, and rebuilds the vector search index.
- **Cleanup**: `cleanup_backups({ keep_count = 5 })` prunes older snapshots while retaining the newest `keep_count` backups.

## Available Tools

- **Backup**: `backup_journal`, `list_backups`, `restore_backup`, `cleanup_backups`
