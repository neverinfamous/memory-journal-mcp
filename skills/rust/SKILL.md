---
name: rust
description: |
  Master production Rust code, lifetimes, and systems programming using a layer-based "meta-cognition" framework. Use whenever writing production Rust code, resolving borrow checker errors (E0382, E0596), designing ownership patterns (Arc, Mutex), or performing crate selection. Do NOT trigger for generic WASM or TS questions unless Rust is the primary focus.
---

# Rust Development & Meta-Cognition

When solving Rust problems, **do not immediately write code.** Trace through the cognitive layers first to understand the data's lifecycle, ownership, and constraints.

## 🧠 1. The Meta-Cognition Framework (Before You Code)

### Layer 1: Domain Constraints (WHY)

What is the system trying to achieve?

- **Web Service:** Concurrent, async, low-latency (Often uses `axum`, `tokio`, `Arc<Mutex<T>>`).
- **CLI Tool:** Fast startup, zero overhead, clean exit codes (Often uses `clap`, `anyhow`, strict error formatting).
- **Embedded / Systems:** No heap allocation (Requires `no_std`, specific hardware limitations).

### Layer 2: Design Choices & Ownership (WHAT)

Ask the core question: **Who should own this data?**

- _Single owner, strictly unique_: Direct value or `Box<T>`.
- _Single thread, multiple owners_: `Rc<T>` (use `RefCell<T>` for mutation).
- _Multi-thread, multiple owners_: `Arc<T>` (use `Mutex<T>` or `RwLock<T>` for mutation).

**Why does it need to mutate?** Avoid slapping `mut` everywhere. Prefer returning new values or using tight, scoped mutability.

### Layer 3: Language Mechanics (HOW)

Use the compiler's strictness as a tool, not an obstacle.

- Implement standard traits: `Drop`, `Clone`, `Default`, `Display`, `From`, `TryFrom`.
- Avoid `unwrap()` or `expect()` in production logic. Propagate errors natively via `?` and `Result`.

---

## 🏗️ 2. Core Ecosystem Defaults

Consult [references/ecosystem.md](references/ecosystem.md) for canonical community crates.

---

## 🛡️ 3. Solving Borrow Checker Errors

Consult [references/borrow-checker.md](references/borrow-checker.md) for diagnostics and resolution paths for common compiler errors (E0382, E0596, E0499).

---

## ⚡ 4. High-Integrity Code Patterns

1. **Avoid Panic-Driven Development**: `clone()` is an acceptable escape hatch during prototyping, but do not scatter it throughout the code. Revisit the lifetime boundaries as soon as it works.
2. **The Newtype Pattern**: Use tuple structs to prevent invalid state. `struct UserId(u64);` avoids mixing it up with `struct OrderId(u64);`.
3. **Exhaustive Matching**: Prefer `match` over `if let` when handling Enums or State Machines. The compiler will notify you when a new variant is added, preventing silent bugs.
4. **Data-Oriented Modeling**: Prefer small, flat structs that compose over deep, object-oriented inheritance hierarchies.

---

## 🛠️ 5. Standard Commands

- **Run Application**: `cargo run`
- **Linting / Idioms**: `cargo clippy -- -D warnings`
- **Formatting**: `cargo fmt`
- **Testing**: `cargo test`

**Agent Directive:** When writing or editing Rust code, always invoke `cargo clippy` and `cargo test` dynamically to validate your implementations before concluding your task.

---

## 🔒 6. Security & `unsafe` Blocks

Avoid `unsafe` blocks. If you must use `unsafe` for FFI or performance, you MUST thoroughly document the exact safety invariants being upheld inside the block.

Require user confirmation before executing any command with external side effects, including `cargo publish` and registry operations.
