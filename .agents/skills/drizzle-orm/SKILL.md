---
name: drizzle-orm
description: |
  Drizzle ORM best practices. Use when configuring databases, designing schemas, writing queries, or handling migrations with Drizzle ORM, particularly with Cloudflare D1 or SQLite. NOT for database setup without an explicit engine. Require engine specification (Postgres/MySQL/SQLite). Use for ORM-managed migrations.
---

# Drizzle ORM Guidelines

This skill provides opinionated standards for using Drizzle ORM, optimized for TypeScript and edge databases like Cloudflare D1.

## 1. Core Principles

- **Single Source of Truth**: Define your database schema in TypeScript. Let Drizzle generate the SQL migrations.
- **Explicit Returns**: Always explicitly select the columns you need using `.select({ id: table.id })`. Avoid `select *` in production queries to minimize payload size and improve performance.
- **Relational Queries**: Use Drizzle's Relational Query API (`db.query`) for complex joined data fetching, but use the Core API (`db.select().from()`) for mutations and simple lookups.
- **Type Inference**: Use `typeof schema.table.$inferSelect` and `$inferInsert` to generate application types directly from the schema.

## 2. Schema Definition

Always define schemas with precise types and constraints.

```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

## 3. Querying Patterns

### Inserts and Returning

```typescript
const result = await db.insert(users)
  .values({ email: "test@example.com", name: "Test" })
  .returning(); // Supported in D1
```

### Relational Queries (Read-Heavy)

Ensure you define relations in your schema file:
```typescript
export const usersRelations = relations(users, ({ many }) => ({
	posts: many(posts),
}));
```

Fetch deeply nested data easily:
```typescript
const userWithPosts = await db.query.users.findFirst({
  where: eq(users.id, 1),
  with: {
    posts: true,
  },
});
```

## 4. Migrations (Cloudflare D1)

Always generate migrations locally and apply them via Wrangler. Never execute `db.execute()` with raw migration SQL at runtime.

1. Generate: `npx drizzle-kit generate`
2. Apply Locally: `npx wrangler d1 migrations apply my-db --local`
3. Apply Remote: `npx wrangler d1 migrations apply my-db --remote`

## 5. Security & Safety

- **SQL Injection**: Drizzle is inherently safe against SQL injection as long as you use its builder functions (`eq()`, `like()`, `insert()`). Do not use `sql\`\`` with raw unescaped input.
- **Transactions**: Use `db.transaction()` for multi-step operations to ensure data integrity.
- **Migration Commits**: Always commit the generated `.sql` migration files to version control.
