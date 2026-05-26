---
name: opentelemetry
description: |
  Observability standards using OpenTelemetry. Use when instrumenting applications for distributed tracing, metrics, and structured logging.
---

# OpenTelemetry (OTel)

Production standards for instrumenting applications to achieve high-fidelity observability.

## 1. Distributed Tracing

- **Trace Context Propagation**: Always propagate the `traceparent` and `tracestate` headers across HTTP and RPC boundaries (using W3C Trace Context).
- **Span Granularity**: Create spans for logical units of work. Avoid creating spans for every single function call (which causes overhead). Focus on:
  - Incoming HTTP requests
  - Database queries
  - External API/LLM calls
  - Background task executions
- **Semantic Conventions**: Use standardized span attributes (e.g., `http.method`, `http.status_code`, `db.system`). Do not invent custom attribute names when standard ones exist.

## 2. Span Implementation Guidelines

- **Status and Errors**: explicitly set the span status to `Error` when an exception occurs, and record the exception object on the span.
- **Payloads**: Avoid logging sensitive PII or massive payloads in span attributes. Log structural identifiers (e.g., `user.id`, `tenant.id`).

```typescript
// Example: Creating a Span in Node.js
tracer.startActiveSpan('database.query', (span) => {
  try {
    span.setAttribute('db.statement', queryText);
    const result = db.execute(queryText);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    throw error;
  } finally {
    span.end();
  }
});
```

## 3. Metrics

- **RED Metrics**: Focus on Rate (requests/sec), Errors (error rate), and Duration (latency distribution).
- **Histograms over Summaries**: Use Histograms for latency measurements to allow accurate percentile aggregations across distributed instances.

## 4. Exporters and Infrastructure

- **OTLP Exporters**: Always export telemetry using the OpenTelemetry Protocol (OTLP) via gRPC or HTTP to an OpenTelemetry Collector, rather than exporting directly to backend vendors (Datadog, Honeycomb) from the application.
- **Batching**: Use batch span processors (`BatchSpanProcessor`) in production to minimize performance overhead. Only use `SimpleSpanProcessor` for local debugging.
