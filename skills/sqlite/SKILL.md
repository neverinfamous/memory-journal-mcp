---
name: sqlite
description: |
  Enforced meta-cognitive rules and production configurations for SQLite development.
  Use when designing SQLite schemas, PRAGMAs, transactions, migrations, locking, or backups.
  Also use when debugging SQLite performance or writing queries against an SQLite database.
  MUST-ASK: Require explicit database engine name before triggering. Never guess. Do NOT use for generic "set up a database" or "create a DB" requests without clarifying. NOT for Postgres or MySQL. NOT for ORM-managed migrations.
---

# SQLite Production Standards

SQLite provides lightweight, serverless SQL, but its default configurations are extremely permissive and optimized for backwards compatibility rather than production rigor.

Any AI agent interacting with or scaffolding SQLite databases MUST adhere to the following strict guidelines to prevent catastrophic concurrency failures, silent data corruption, or locking issues.

**Agent Routing Rule:** When encountering vague requests like "set up a database", you MUST refuse to guess and ask the user for the specific engine before assuming SQLite.

## Concurrency & Performance (Critical Mandates)

SQLite only permits one writer at a time. To prevent random `SQLITE_BUSY` errors and enable high-performance read-while-writing:

- **Enable WAL Mode**: Generally, you should execute `PRAGMA journal_mode=WAL;` immediately upon connection for high concurrency, unless the database is on a networked filesystem where WAL is unsafe. Ensure the `-wal` and `-shm` sidecar files are managed alongside the main `.db` file.
- **Configure Timeouts**: Set `PRAGMA busy_timeout=5000;` so writers wait up to 5 seconds before failing.
- **Early Lock Acquisition**: Use `BEGIN IMMEDIATE;` to grab the write lock early and prevent deadlocks in read-then-write batch patterns, but note this locks the database for all other writers.
- **Synchronization**: `PRAGMA synchronous=NORMAL;` provides the best balance of safety and speed while in WAL mode.

## Data Integrity & Type Safety

SQLite's default type system uses "Type Affinity" (it will happily accept the string "hello" in an `INTEGER` column) and ignores foreign keys.

- **Foreign Keys**: You MUST execute `PRAGMA foreign_keys=ON;` on every single new database connection. It is not persisted. Without this, `ON DELETE CASCADE` fails silently.
- **Strict Typing**: For all new tables, strongly prefer appending `STRICT` to the `CREATE TABLE` statement (e.g., `CREATE TABLE users (...) STRICT;`) to enforce real data types. This is supported in SQLite 3.37.0+.
- **Date/Time Handling**: There is no native DATE/TIME type. Standardize on `TEXT` (ISO8601) or `INTEGER` (Unix timestamp).
- **Booleans**: Do not use `BOOLEAN`. Use `INTEGER` (0/1). `TRUE` and `FALSE` are just aliases.

## Security & Injection Prevention

- **Parameterization**: You MUST use parameterized queries for all user-supplied values. Never interpolate strings or concatenate variables directly into SQL queries.
- **Dynamic SQL**: When building dynamic queries (e.g., variable `ORDER BY` clauses or dynamic table names where parameterization isn't supported), validate inputs against a strict allowlist. Do not construct SQL syntax directly from user input.

## Schema Modifications & Transactions

- **Alter Table Limitations**: `ALTER TABLE` is extremely limited. To perform complex schema migrations, you must wrap the operation in a transaction: create a new table, copy the data over, drop the old table, and rename the new one.
- **Batch Modifying**: Autocommit is ON by default. If you are inserting or modifying multiple rows, you MUST batch them in a transaction (`BEGIN; ... COMMIT;`) to achieve 10x-100x speedups.

## Maintenance & Backups

- **Vacuuming**: Deleted data does not shrink the `.db` file. After bulk deletes, run `VACUUM;` to reclaim space. Ensure the host system has at least 2x the database size in temporary disk space. WARNING: If running in WAL mode, you MUST execute `PRAGMA wal_checkpoint(TRUNCATE);` before vacuuming to safely merge the journal.
- **Safety**: NEVER blindly copy an open `.db` file using standard OS commands, as it will corrupt if a write is in progress. Use the `.backup` command in the CLI, the native backup API, or `VACUUM INTO 'backup.db'`.
