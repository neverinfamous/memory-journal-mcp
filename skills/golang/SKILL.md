---
name: golang
description: |
  Master Go development using production-grade best practices merged from the Google and Uber style guides. Use whenever writing Go code, designing APIs, handling errors, managing goroutines, or configuring linters.
---

# Golang Engineering Standards

This skill synthesizes the absolute best practices from the ecosystem (Uber Guide, Google Guide, and community consensus) to ensure written Go code is idiomatic, performant, and safe.

## 1. Interface & API Design

- **Accept Interfaces, Return Structs**: Define interfaces where they are consumed (by the caller), not where they are implemented. Return concrete structs from constructors so callers can use all methods or mock as needed.
- **Context is King**: `context.Context` must **always** be the first parameter of any function doing I/O or asynchronous work.
- **Never Store Context**: Do not store `context.Context` inside structs. It is meant to flow entirely through the function stack.
- **No Dependency Injection via Context**: Only use `context.WithValue` for request-scoped data (like trace IDs, user claims). Never use it to pass databases, loggers, or configuration.

## 2. Error Handling

- **Wrapping Options**: Use `fmt.Errorf("doing operation: %w", err)` to preserve the underlying error for `errors.Is` or `errors.As`. Use `%v` only if you explicitly want to hide the underlying error's identity.
- **Never Log AND Return**: Pick one. If you log an error, handle it there. If you return it, let the caller log it. Doing both creates duplicate noise in APM systems.
- **Sentinel Errors**: Define top-level exported errors for standard package failure modes (`var ErrNotFound = errors.New(...)`). Use `errors.Is(err, ErrNotFound)` rather than string comparisons.

## 3. Concurrency & Goroutines

- **Know When To Stop**: Never start a goroutine without knowing exactly how and when it will terminate. Unbounded or untracked goroutines cause devastating memory leaks.
- **Coordination**: Use `sync.WaitGroup` to wait for a pool of workers.
- **Channels vs Mutexes**:
  - Use `chan` to pass ownership of data between concurrent routines.
  - Use `sync.Mutex` to protect shared state accessed from multiple routines.
- **Lock Discipline**: Keep the critical section of a lock as short as physically possible. **Never** perform I/O while holding a mutex.

## 4. Naming Conventions (No Stuttering)

- **Getters**: Go does not use `Get` prefixes for getters. If a struct has an `Owner` field, the getter is `Owner()`, not `GetOwner()`. The setter would be `SetOwner()`.
- **Stuttering**: Avoid package/type name redundancy.
  - _Bad_: `user.UserConfig`, `log.Logger`.
  - _Good_: `user.Config`, `log.Entry`.
- **Interfaces**: Single-method interfaces should end in `-er` (`Reader`, `Writer`, `Formatter`).
- **Short Variable Names**: Idiomatic Go uses very short variables for scope-limited entities (`idx` instead of `index`, `b` instead of `buffer`, `r` instead of `reader`).

## 5. Performance & Data Structures

- **Capacity Pre-allocation**: Always use `make([]T, 0, capacity)` or `make(map[K]V, capacity)` when the target size is known. This dramatically reduces heap allocations during append loops.
- **Nil vs Empty**: A `nil` slice (`var names []string`) is idiomatically correct, functionally identical to a zero-length slice, and requires zero allocations. Use it over `names := []string{}` unless JSON formatting explicitly demands an empty array `[]` instead of `null`.

## 6. Testing

- **Table-Driven Tests**: Always utilize `[]struct{ name string ... }` iterated via `t.Run()` for clear, modular test cases.
- **t.Helper()**: Ensure any custom assertion or setup function immediately calls `t.Helper()` so test runner output points to the actual failure site, not the inside of the utility function.

## 7. Tooling & Enforcement

- The agent should prioritize running `go fmt ./...` and `golangci-lint run` (if available) before confirming code completion.
