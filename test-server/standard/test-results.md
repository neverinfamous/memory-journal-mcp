# Token Consumption during Direct Tool Testing of postgres-mcp

Last tested: April 6th, 2026

| Test Document                | Approximate Token Usage | Notes                            |
| :--------------------------- | :---------------------- | :------------------------------- |
| `test-core-admin.md`         | ~7,647                  |                                  |
| `test-core-crud.md`          | ~3,588                  |                                  |
| `test-core-infra.md`         | ~270                    |                                  |
| `test-core-relationships.md` | ~1,554                  |                                  |
| `test-core-search.md`        | ~7,100                  |                                  |
| `test-core-semantic.md`      | ~11,392                 | bloat from `test-core-search.md` |
| `test-github.md`             | ~3,800                  |                                  |
| `test-resources.md`          | ~359                    |                                  |
| `test-schemas.md`            | ~386                    |                                  |
| `test-seed.md`               | ~6,800                  |                                  |
| `test-team.md`               | ~10,314                 |                                  |
| `test-tool-group-admin.md`   | ~1,576                  |                                  |
| `test-tool-group-backup.md`  | ~406                    |                                  |
| `test-tool-group-core.md`    | ~1,642                  |                                  |
| `test-tool-group-github.md`  | ~4,992                  |                                  |
| `test-tool-group-search.md`  | ~32,602                 | bloat from search tests above    |
| `test-tool-group-team.md`    | ~2,300                  |                                  |
| **Total Estimated Tokens**   | **~96,728**             |                                  |

**Token counts don't include tokens used by the testing prompts themselves.**
