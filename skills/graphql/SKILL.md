---
name: graphql
description: |
  GraphQL best practices. Use when designing GraphQL schemas, writing resolvers, handling mutations, avoiding N+1 query problems (DataLoader), or configuring GraphQL servers. NOT for REST APIs, generic database design, or ORM setups.
---

# GraphQL Best Practices

Standards for designing and implementing GraphQL APIs.

## 1. Schema Design

- **Business Logic Isolation**: Do not write business logic inside resolvers. Resolvers should only extract arguments and pass them to dedicated service/domain layer functions.
- **Nullability**: Be mindful of non-null (`!`) fields. Only mark fields as non-null if you are absolutely certain they will never be missing, as a single null in a non-null field will bubble up and destroy the entire parent object.
- **Custom Scalars**: Use custom scalars (e.g., `DateTime`, `Email`) to enforce type constraints at the schema level instead of raw `String`.

## 2. Mutations

- **Input Types**: Use a single, required `input` object argument for mutations instead of passing many individual arguments.
- **Payload Types**: Return a specific payload type (e.g., `UpdateUserPayload`) that includes the mutated object and any potential operation-specific errors, rather than just returning the object.

## 3. Performance (N+1 Problem)

- **DataLoader**: ALWAYS use Facebook's `dataloader` pattern (or equivalent) to batch and cache database requests for nested relationships. Never loop and await queries inside child resolvers.
- **Query Complexity**: Implement query complexity limits or depth limits on your GraphQL server to prevent malicious or accidental resource exhaustion.

## 4. Error Handling

- Use the standard `errors` array for unexpected exceptions.
- For business logic errors (e.g., "Email already taken"), model them as Union types in your schema (e.g., `union CreateUserResult = User | EmailAlreadyTakenError`) so clients can handle them gracefully.
