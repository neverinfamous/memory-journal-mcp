# Importance Score Reference

### Formula

| Component         | Weight | Max Score | How It's Earned                                                        |
| ----------------- | ------ | --------- | ---------------------------------------------------------------------- |
| **Significance**  | 0.30   | 0.30      | Entry has a `significance_type` (milestone, decision, release, etc.)   |
| **Relationships** | 0.35   | 0.35      | Entry has ≥5 relationships (linear scale: 1 rel = 0.07)                |
| **Causal**        | 0.20   | 0.20      | Entry has ≥3 causal relationships (`blocked_by`, `resolved`, `caused`) |
| **Recency**       | 0.15   | 0.15      | Created within the last 90 days (linear decay to 0 at day 90)          |

### Threshold Guide

| Score       | Label      | Meaning                                                  |
| ----------- | ---------- | -------------------------------------------------------- |
| `0.00`      | Expendable | No significance, no relationships, older than 90 days    |
| `0.01–0.14` | Low        | Minimal context — weak tags or a single old relationship |
| `0.15–0.29` | Moderate   | Has some context but not structurally important          |
| `0.30–0.49` | High       | Well-connected or has significance markers               |
| `0.50+`     | Critical   | Major decisions, densely linked entries, milestones      |
