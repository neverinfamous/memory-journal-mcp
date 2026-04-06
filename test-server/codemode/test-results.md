# Token Consumption during Direct Tool Testing of postgres-mcp

Last tested: April 6th, 2026

| Test Document                   | Approximate Token Usage | Notes |
| :------------------------------ | :---------------------- | :---- |
| `test-cm-admin-backup.md`       | ~206                    |       |
| `test-cm-api-discovery.md`      | ~406                    |       |
| `test-cm-crud.md`               | ~720                    |       |
| `test-cm-github.md`             | ~857                    |       |
| `test-cm-orchestration.md`      | ~302                    |       |
| `test-cm-readonly.md`           | ~983                    |       |
| `test-cm-relationships.md`      | ~199                    |       |
| `test-cm-sanbox-basics.md`      | ~504                    |       |
| `test-cm-search.md`             | ~650                    |       |
| `test-cm-security.md`           | ~256                    |       |
| `test-cm-team-admin.md`         | ~699                    |       |
| `test-cm-team-crud.md`          | ~5,380                  |       |
| `test-cm-team-vector-errors.md` | ~3,365                  |       |
| `test-cm-workflows.md`          | ~4,174                  |       |
| **Total Estimated Tokens**      | ~XX, XXX                |       |

**Safe to test in pairs**
jsonb + vector
postgis + ltree
pgcrypto + citext
text + cron
partman + partitioning
stats + backup

**Token counts don't include tokens used by the testing prompts themselves.**
