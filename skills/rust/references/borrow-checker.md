# Solving Borrow Checker Errors

When debugging compiler errors, trace **up** from the syntax error to the fundamental design choice.

- **E0382 (Use of moved value):**
  - _Symptom:_ You are trying to use a value after it was consumed.
  - _Resolve:_ Does the function actually _need_ ownership? Borrow it instead (`&T`), `clone()` it if lightweight, or wrap in `Arc<T>` if access needs to be shared across threads.
- **E0596 (Cannot borrow as mutable):**
  - _Symptom:_ You are mutating something behind an immutable reference `&T`.
  - _Resolve:_ Change the signature to `&mut T`, or if you must have an immutable interface, use interior mutability (`Cell` or `Mutex`).
- **E0499 (Cannot borrow multiple times):**
  - _Symptom:_ Alive mutable references colliding.
  - _Resolve:_ Restructure the function to limit the reference's scope `{}`, or avoid holding mutable borrows across `await` points.
