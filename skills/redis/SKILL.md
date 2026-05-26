---
name: redis
description: |
  Redis best practices. Use when configuring caching strategies, connection pooling, handling TTLs (Time-To-Live), or managing Redis data structures (Hash, Set, List) in Node/TypeScript projects.
---

# Redis Best Practices

Standards for deploying and using Redis as a cache or key-value store.

## 1. Connection Management
- **Connection Pooling**: Use a persistent connection object across your application. Do not create a new Redis client on every request.
- **Timeouts & Reconnects**: Always configure `connectTimeout` and strict reconnect strategies. Redis can drop connections under load; your app must handle retries gracefully without stalling.

## 2. Caching Strategies
- **Cache-Aside Pattern**: Read from cache; if miss, read from DB and write to cache with a TTL.
- **Thundering Herd**: Use brief locks (distributed locking) or stale-while-revalidate patterns for heavily accessed keys that expire, to prevent database spikes.
- **TTL (Time-To-Live)**: ALWAYS attach a TTL to cache keys unless the key is definitively a permanent config value. Use staggered TTLs (e.g., base TTL + random jitter) to avoid mass expirations.

## 3. Data Structures
- **Hashes (HSET/HGET)**: Use Hashes to store objects instead of stringified JSON when you need to update or read individual fields.
- **Sets (SADD/SMEMBERS)**: Use Sets for unique collections (e.g., user IDs online) and quick membership checks.
- **Pipelines**: Use `MULTI`/`EXEC` or Pipelines to batch commands together and save network round trips.

## 4. Security
- Never expose the Redis port (`6379`) to the public internet. Ensure it is accessible only within a VPC or private network.
- Use TLS (`rediss://`) and authentication for managed instances (e.g., AWS ElastiCache, Render Redis).
