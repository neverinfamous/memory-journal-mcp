---
name: auth-identity
description: |
  Standards for Authentication and Identity management. Use when configuring OAuth, JWTs, sessions, RBAC (Role-Based Access Control), or integrating auth providers (Auth0, Clerk, NextAuth).
---

# Authentication & Identity

## Security Principles
- **OAuth & OIDC**: Use standard flows (Authorization Code with PKCE).
- **Session Management**: Prefer secure, HTTP-only cookies over local storage for tokens.
- **RBAC/ABAC**: Implement authorization checks at both the API and UI layers.
- **Secrets**: Never expose JWT secrets or provider credentials.
