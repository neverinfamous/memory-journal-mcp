---
name: mysql
description: Enterprise MySQL & MariaDB production rules — query safety, connection pooling, and strict schema configurations.
---

# MySQL / MariaDB Production Standards

MySQL and MariaDB are powerful relationship-driven databases, but AI agents MUST adhere to these strict behavioral boundaries when executing queries, utilizing the `mysql-mcp` server, or generating application code.

## 1. Query Safety & Execution Rules
- **Absolute Parameterization**: You MUST ALWAYS use parameterized queries (`?`). Under zero circumstances are you permitted to string-interpolate or concatenate variables into a raw SQL string. This is to enforce strict SQL-injection prevention.
- **Guarded Reads**: Every top-level `SELECT` statement MUST contain a `LIMIT` clause unless explicitly overridden by the user. Do not execute unbounded `SELECT * FROM table;` queries.
- **Safe Destructive Ops**: `DELETE` and `UPDATE` queries MUST include a `WHERE` clause. Never execute these operations without a targeted identifier.
- **Action Scoping**: Limit operations to single-statements. Do not stack multiple statements (`query1; query2;`) in a single payload unless executing a batch migration.

## 2. Connections & Transactions
- **Connection Pooling**: Always assume and design for connection pooling. Code evaluating database connections should handle acquiring from and releasing to a pool, avoiding connection leaks.
- **Data Mutability Scopes**: Whenever executing writes spanning across multiple tables (e.g., inserts requiring foreign key links), they MUST be wrapped in a transaction block: `START TRANSACTION; ... COMMIT;` with robust `ROLLBACK` logic in the `catch` block.

## 3. Strict Schema Configurations
- **Mode Enforcement**: Ensure `sql_mode` includes `STRICT_TRANS_TABLES` and `ONLY_FULL_GROUP_BY`. AI agents must not disable these modes to bypass errors; you must rewrite your `GROUP BY` logic to be strictly compliant.
- **Foreign Keys**: Explicitly define `FOREIGN KEY` constraints during `CREATE TABLE` unless specifically orchestrating a Vitess/PlanetScale sharded environment where declarative FKs are explicitly forbidden by the user context.

## 4. Ecosystem & Diagnostics
- **Error Handling**: When intercepting connection drops or authentication failures (e.g., ER_ACCESS_DENIED_ERROR), instruct the user to verify their `.env` configurations (`MYSQL_URL`, `MYSQL_HOST`, etc.). Do not hallucinate database names.
- **Using MCP**: If the `mysql-mcp` server is attached, prefer utilizing its formal 227+ structured tools over executing raw Bash CLI scripts (`mysql -h ...`) to guarantee payload optimizations and schema intelligence.
