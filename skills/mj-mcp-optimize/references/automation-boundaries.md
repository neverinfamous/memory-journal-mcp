# Automation Boundaries

### What's Automated (No HITL)
| Phase | Action | Safety |
|-------|--------|--------|
| 1. Audit | Importance distribution, tag consistency scan, stale detection | ✅ Read-only |
| 2. Enrichment | Auto-link orphans (similarity > 0.85, max 10/project/run) | ✅ Non-destructive |
| 2. Enrichment | Auto-merge exact duplicate tags to kebab-case | ✅ Non-destructive |
| 3. Detection | Duplicate pairs, delete candidates | ✅ Report only |
| 4. Report | Create maintenance entry with health report | ✅ Single entry |

### What Requires Human Review
- All delete operations (soft or hard)
- Fuzzy tag matches (Levenshtein ≤ 2 but not exact normalization match)
- Orphan links with similarity ≤ 0.85
- Any entry with `significance_type` set
