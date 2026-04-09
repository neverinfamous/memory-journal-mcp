---
name: postgres
description: Enterprise PostgreSQL production rules — advanced querying, indexing, JSONB data, and strict optimization patterns.
---

# PostgreSQL Production Standards

PostgreSQL is a deeply capable object-relational database. Because of its advanced feature set, AI agents and orchestrated deployment workflows MUST adhere to strict operational boundaries to avoid common pitfalls like index bloating, inefficient JSONB parsing, and locking regressions.

## 1. Advanced Querying & Safety

- **Strict Parameterization**: Just like MySQL, executing parameterized queries (`$1, $2, ...`) is a non-negotiable hard mandate. String interpolation is globally prohibited.
- **Explicit Columns**: NEVER use `SELECT *` in production code. You must specifically query required columns. This minimizes data transfer latency and prevents application crashes if schema columns mutate.
- **N+1 Avoidance**: Agents scaffolding code must implement batch loading architectures (e.g., `DataLoader`) or advanced `JOIN` logic when building APIs. Do not execute identical iterative queries inside loops.
- **Guarded Modifications**: Any `UPDATE` or `DELETE` MUST contain a deterministic `WHERE` block.

## 2. Advanced Indexing Patterns

- **Targeted Strategies**: Do not blindly index every column. Optimize based on frequency.
- **Partial Indexes**: If you routinely query states like `WHERE active = true`, you must use a Partial Index (`CREATE INDEX idx_active_users ON users(email) WHERE active = true;`) instead of indexing the entire column.
- **Composite Layout**: For standard queries targeting multiple identifiers, employ Composite Indexes with the most selective columns first.

## 3. Operations & Migrations

- **Transaction Safety**: Wrap multi-step mutations in `BEGIN; ... COMMIT;`. Standardize transactions to stay small and fast to prevent lock contentions.
- **Analytical Overviews**: Use `EXPLAIN ANALYZE` locally when debugging slow queries to analyze sequential sweeps relative to index scans.
- **Schema Extensibility**: Add constraints and columns dynamically (e.g., `ALTER TABLE users ADD CONSTRAINT unique_email UNIQUE (email);`). Always apply sane `DEFAULT` properties to avoid backfilling issues on massive tables.

## 4. Modern PostGres Functionality

- **JSONB Arrays/Objects**: Use `JSONB`, never `JSON`. JSONB is stored in a decomposed binary format, allowing fast, native index checking (via `@>` or `?` operators) instead of full parsing upon retrieval.
- **Row-Level Security (RLS)**: Emphasize defining default-deny security protocols using `ENABLE ROW LEVEL SECURITY`.
- **Ecosystem Integration**: Whenever available, prefer using structured `postgres-mcp` tools for safe schema interpretation over native Bash `psql` piping.
