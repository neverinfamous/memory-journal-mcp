---
title: Rust Development
description: |
  Master Rust development using a layer-based "meta-cognition" framework. Use whenever writing Rust code, resolving borrow checker errors (E0382, E0596), designing ownership patterns (Arc, Mutex), or performing crate selection. 
---

# Rust Development & Meta-Cognition

When solving Rust problems, **do not immediately write code.** Trace through the cognitive layers first to understand the data's lifecycle, ownership, and constraints.

## 🧠 1. The Meta-Cognition Framework (Before You Code)

### Layer 1: Domain Constraints (WHY)
What is the system trying to achieve?
- **Web Service:** Concurrent, async, low-latency (Requires `axum`, `tokio`, `Arc<Mutex<T>>`).
- **CLI Tool:** Fast startup, zero overhead, clean exit codes (Requires `clap`, `anyhow`, strict error formatting).
- **Embedded / Systems:** No heap allocation (Requires `no_std`, specific hardware limitations).

### Layer 2: Design Choices & Ownership (WHAT)
Ask the core question: **Who should own this data?**
- *Single owner, strictly unique*: Direct value or `Box<T>`.
- *Single thread, multiple owners*: `Rc<T>` (use `RefCell<T>` for mutation).
- *Multi-thread, multiple owners*: `Arc<T>` (use `Mutex<T>` or `RwLock<T>` for mutation).

**Why does it need to mutate?** Avoid slapping `mut` everywhere. Prefer returning new values or using tight, scoped mutability. 

### Layer 3: Language Mechanics (HOW)
Use the compiler's strictness as a tool, not an obstacle. 
- Implement standard traits: `Drop`, `Clone`, `Default`, `Display`, `From`, `TryFrom`.
- Avoid `unwrap()` or `expect()` in production logic. Propagate errors natively via `?` and `Result`.

---

## 🏗️ 2. Core Ecosystem Defaults

When selecting crates or recommending tools, stick to these canonical community standards:

* **Async Runtime**: `tokio` (I/O bound) or `rayon` (CPU bound data-parallelism)
* **Web / API Server**: `axum` (built on tokio/hyper)
* **Serialization/Deserialization**: `serde` and `serde_json`
* **Error Handling**: `thiserror` (for libraries), `anyhow` or `color-eyre` (for binaries)
* **Command Line Parsing**: `clap`
* **Logging & Telemetry**: `tracing` and `tracing-subscriber`
* **HTTP Client**: `reqwest`

---

## 🛡️ 3. Solving Borrow Checker Errors

When debugging compiler errors, trace **up** from the syntax error to the fundamental design choice.

* **E0382 (Use of moved value):** 
  * *Symptom:* You are trying to use a value after it was consumed.
  * *Resolve:* Does the function actually *need* ownership? Borrow it instead (`&T`), `clone()` it if lightweight, or wrap in `Arc<T>` if access needs to be shared across threads.
* **E0596 (Cannot borrow as mutable):** 
  * *Symptom:* You are mutating something behind an immutable reference `&T`.
  * *Resolve:* Change the signature to `&mut T`, or if you must have an immutable interface, use interior mutability (`Cell` or `Mutex`).
* **E0499 (Cannot borrow multiple times):** 
  * *Symptom:* Alive mutable references colliding.
  * *Resolve:* Restructure the function to limit the reference's scope `{}`, or avoid holding mutable borrows across `await` points.

---

## ⚡ 4. High-Integrity Code Patterns

1. **Avoid Panic-Driven Development**: `clone()` is an acceptable escape hatch during prototyping, but do not scatter it throughout the code. Revisit the lifetime boundaries as soon as it works.
2. **The Newtype Pattern**: Use tuple structs to prevent invalid state. `struct UserId(u64);` avoids mixing it up with `struct OrderId(u64);`.
3. **Exhaustive Matching**: Always use `match` over `if let` when handling Enums or State Machines. The compiler will notify you when a new variant is added, preventing silent bugs.
4. **Data-Oriented Modeling**: Prefer small, flat structs that compose over deep, object-oriented inheritance hierarchies. 

---

## 🛠️ 5. Standard Commands

* **Run Application**: `cargo run`
* **Linting / Idioms**: `cargo clippy -- -D warnings`
* **Formatting**: `cargo fmt`
* **Testing**: `cargo test`

**Agent Directive:** When writing or editing Rust code, always invoke `cargo clippy` and `cargo test` dynamically to validate your implementations before concluding your task.
