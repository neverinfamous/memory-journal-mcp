export const BACKUP_HELP = `# Backup Operations
- **Snapshots**: Create on-demand snapshot backups of the database. Useful before performing destructive administrative operations like batch deletions.
- **Restore**: Restore the entire database state from a specific backup snapshot.
- **Cleanup**: Remove old or unnecessary backups to save disk space.

## Available Tools

- \`backup_journal\`: Create a timestamped backup of the journal database.
- \`list_backups\`: List all available backup files with their sizes and creation dates.
- \`restore_backup\`: Restore the journal database from a backup file (automatically creates a pre-restore backup).
- \`cleanup_backups\`: Delete old backup files, keeping only the most recent N backups.
`;
