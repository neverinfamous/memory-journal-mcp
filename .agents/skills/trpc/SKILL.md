---
name: trpc
description: |
  tRPC standards for TypeScript backends. Use when building end-to-end typesafe APIs, defining routers, procedures, middleware, or integrating with React and Next.js.
---

# tRPC Guidelines

tRPC enables end-to-end typesafe APIs without code generation or GraphQL schemas. It is highly recommended for full-stack TypeScript applications (e.g., Next.js, React).

## 1. Routers and Procedures

- **Input Validation**: Always use Zod for procedure input validation. Never trust client payloads.
- **Query vs Mutation**: Use `publicProcedure.query()` for read operations (GET) and `publicProcedure.mutation()` for writes/updates (POST).
- **Modularity**: Break large routers into sub-routers (e.g., `userRouter`, `postRouter`) and merge them into an `appRouter`.

```typescript
import { z } from 'zod';
import { publicProcedure, router } from './trpc';

export const userRouter = router({
  getUser: publicProcedure
    .input(z.string())
    .query(async ({ input, ctx }) => {
      return ctx.db.user.findById(input);
    }),
  createUser: publicProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.db.user.create(input);
    }),
});
```

## 2. Context and Middleware

- **Context Injection**: Use the `createContext` function to inject database instances, user session data, and request metadata (headers) into every procedure.
- **Middleware Security**: Implement reusable middlewares for authorization (e.g., `protectedProcedure`) rather than checking auth in every single procedure.

```typescript
const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({
    ctx: {
      session: { ...ctx.session, user: ctx.session.user },
    },
  });
});

export const protectedProcedure = t.procedure.use(isAuthed);
```

## 3. Client Integration

- **React Query**: Use `@trpc/react-query` to consume APIs in React. This provides caching, invalidation, and loading states automatically.
- **Invalidation**: After a mutation succeeds, always invalidate the relevant queries (e.g., `utils.users.getAll.invalidate()`) to refresh the UI.
