# memory-journal-mcp Observability Examples

Portable, self-hosted observability templates for monitoring `memory-journal-mcp` with Prometheus, Grafana, Loki, Grafana Alloy, and Datadog OpenMetrics Autodiscovery v2.

---

## Included Files

| File | Purpose |
| --- | --- |
| [`docker-compose.monitoring.yml`](./docker-compose.monitoring.yml) | Runs `memory-journal-mcp` (`:3000` + `:9465`), Prometheus (`v3.16.0` on `:9090`), Loki (`3.7.1` on `:3100`), Grafana Alloy (`v1.15.1`), and Grafana (`13.3.1` on `:3001`). |
| [`prometheus.yml`](./prometheus.yml) | Scrapes `memory-journal-mcp:9465/metrics` every 15s using Bearer token authentication from `/etc/prometheus/metrics.token`. |
| [`alloy-config.alloy`](./alloy-config.alloy) | Tails JSONL audit events from `/var/log/memory-journal/mcp-audit.jsonl`, promotes structured labels (`tool`, `category`, `scope`, `success`), and ships logs to Loki. |
| [`datadog-labels.yml`](./datadog-labels.yml) | Docker Compose overlay adding Datadog OpenMetrics Autodiscovery v2 labels (`max_returned_metrics: 10000`, `send_monotonic_counter: true`) and log collection metadata. |
| [`grafana/dashboards/`](./grafana/dashboards/) | Pre-provisioned Grafana dashboards (`Memory-Journal-MCP Token & Tool Metrics`, `AI Efficiency`, and `Logs (Loki)`). |
| [`grafana/provisioning/`](./grafana/provisioning/) | Grafana Prometheus + Loki datasource and dashboard auto-provisioning manifests. |
| [`datadog-dashboard.json`](./datadog-dashboard.json) | Portable Datadog overview dashboard for tool calls, token volume, latency percentiles, resource reads, and audit/error logs. |
| [`datadog-ai-dashboard.json`](./datadog-ai-dashboard.json) | Portable Datadog AI efficiency dashboard for token-to-call ratios, error rates, and cost estimation. |

---

## Quick Start

### 1. Generate Auth Token & `.env`

Because the standalone Prometheus metrics server enforces fail-closed authentication when bound to `0.0.0.0` (and rejects default placeholder tokens), generate a real random token before starting the stack:

```bash
TOKEN=$(openssl rand -hex 32)
printf 'MCP_AUTH_TOKEN=%s\nGF_ADMIN_PASSWORD=admin\nDD_REPORTED_HOSTNAME=memory-journal-mcp-host\n' "$TOKEN" > examples/observability/.env
printf '%s' "$TOKEN" > examples/observability/metrics.token
```

### 2. Start the Monitoring Stack

```bash
docker compose -f examples/observability/docker-compose.monitoring.yml up -d
```

Optional: overlay Datadog OpenMetrics Autodiscovery v2 labels if a Datadog Agent monitors the Docker socket:

```bash
docker compose \
  -f examples/observability/docker-compose.monitoring.yml \
  -f examples/observability/datadog-labels.yml \
  up -d
```

### 3. Access Services

- **MCP HTTP Transport**: `http://localhost:3000/health` (and `/mcp`)
- **Prometheus Metrics**: `http://127.0.0.1:9465/metrics` (`Authorization: Bearer <MCP_AUTH_TOKEN>`)
- **Prometheus UI**: `http://localhost:9090` (**Status** → **Targets**)
- **Grafana UI**: `http://localhost:3001` (`admin` / `GF_ADMIN_PASSWORD`) — Prometheus, Loki, and all 3 dashboards load automatically.
- **Loki Ready API**: `http://localhost:3100/ready`

---

## Architecture & Security Notes

- **Fail-Closed Non-Loopback Metrics**: Standalone `MJ_METRICS_PORT` (`9465`) binds to `127.0.0.1` by default. Setting `MJ_METRICS_HOST=0.0.0.0` inside Docker requires a non-placeholder `MCP_AUTH_TOKEN` (`MCP_AUTH_SCOPES=full` enables per-user breakdown via `audit` scope).
- **OAuth 2.1 Mode**: When `--oauth-enabled` is used **without** a static `MCP_AUTH_TOKEN`, `memory-journal-mcp` skips the standalone `:9465` port fail-closed; configure Prometheus/scrapers to hit the OAuth-protected `GET /metrics` endpoint on the HTTP transport (`:3000`) with an `audit`-scoped token instead.
- **Resource URI Cardinality Normalization**: Query parameters (`?session_id=...`) and `#fragments` are stripped before recording `mcp_resource_reads_total{resource}`, preventing dynamic session URIs from exhausting metric cardinality.
- **Single-Source Datadog Collection**: When using `datadog-labels.yml` for OpenMetrics Autodiscovery v2, do not simultaneously mount a static `openmetrics.d/conf.yaml` targeting the same container.
