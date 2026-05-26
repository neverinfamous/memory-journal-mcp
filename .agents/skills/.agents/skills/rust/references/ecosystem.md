# Core Ecosystem Defaults

When selecting crates or recommending tools, stick to these canonical community standards:

- **Async Runtime**: `tokio` (I/O bound) or `rayon` (CPU bound data-parallelism)
- **Web / API Server**: `axum` (built on tokio/hyper)
- **Serialization/Deserialization**: `serde` and `serde_json`
- **Error Handling**: `thiserror` (for libraries), `anyhow` or `color-eyre` (for binaries)
- **Command Line Parsing**: `clap`
- **Logging & Telemetry**: `tracing` and `tracing-subscriber`
- **HTTP Client**: `reqwest`
