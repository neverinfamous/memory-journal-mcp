---
name: zod
description: |
  Zod schema validation standards. Use when defining schemas, parsing user input, transforming data, or integrating type-safe boundaries in API endpoints and configurations. SECURITY: Zod schemas are your primary security boundary. Ensure they are strict and handle all edge cases.
---

# Zod Schema Validation

Zod provides strict schema validation and static type inference. It is mandatory for all system boundaries (API endpoints, MCP tools, database inputs, environment variables).

## 1. Parsing vs Safe Parsing

- **`schema.parse()`**: Throws a `ZodError` if validation fails. Use this when the framework handles errors globally (e.g., tRPC, Next.js server actions with error boundaries).
- **`schema.safeParse()`**: Returns `{ success: true, data }` or `{ success: false, error }`. Use this when you need to handle validation errors gracefully without throwing exceptions (e.g., in MCP tool execution handlers or client-side form logic).

## 2. Refinements and SuperRefinements

- **`.refine()`**: Use for custom validation logic (e.g., verifying a string is a valid ID in the database).
- **`.superRefine()`**: Use when you need to attach errors to specific fields within a nested object structure, rather than just the top level.

```typescript
const passwordSchema = z.string().superRefine((val, ctx) => {
  if (val.length < 8) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Too short' })
  }
})
```

## 3. Transformations

- **`.transform()`**: Use transforms to parse strings into numbers, trim whitespace, or instantiate objects (e.g., converting an ISO string to a `Date` object).
- **`.catch()` / `.default()`**: Use to provide fallback values for resilient parsing.

## 4. Environment Variables

- **Mandatory Env Validation**: Use Zod to parse `process.env` at application startup. This ensures the app crashes immediately with a clear error if required variables are missing, rather than failing silently later.

```typescript
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
})
export const env = envSchema.parse(process.env)
```

## 5. Inference

- Always infer TypeScript types directly from the schema using `z.infer<typeof schema>`. Never manually write interfaces that duplicate Zod schemas.
