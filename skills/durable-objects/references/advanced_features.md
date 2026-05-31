# Advanced Durable Object Features

## Storage Operations

```typescript
// SQL (synchronous, recommended)
this.ctx.storage.sql.exec('INSERT INTO t (c) VALUES (?)', value)
const rows = this.ctx.storage.sql.exec<Row>('SELECT * FROM t').toArray()

// KV (async)
await this.ctx.storage.put('key', value)
const val = await this.ctx.storage.get<Type>('key')
```

## Alarms

```typescript
// Schedule (replaces existing)
await this.ctx.storage.setAlarm(Date.now() + 60_000);

// Handler
async alarm(): Promise<void> {
  // Process scheduled work
  // Optionally reschedule: await this.ctx.storage.setAlarm(...)
}

// Cancel
await this.ctx.storage.deleteAlarm();
```
