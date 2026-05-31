---
name: auth-identity
description: |
  Standards for Authentication and Identity management. Use when configuring OAuth, JWTs, sessions, RBAC (Role-Based Access Control), or integrating auth providers (Auth0, Clerk, NextAuth). SECURITY: Implementing auth requires strict fallback logic. Never fail-open. Handle token expiration and revocation gracefully.
---

# Authentication & Identity

This skill outlines the strict security requirements and architectural patterns for implementing Authentication and Identity (AuthN/AuthZ) in modern applications.

## Security Gates (CRITICAL)

> **CRITICAL HITL GATE**: You MUST stop and ask the user for explicit confirmation before modifying authentication flows, updating token expiration times, changing cookie settings (`httpOnly`, `Secure`), or adding new OAuth providers.
> Auth changes carry high risk of introducing vulnerabilities. Never silently commit auth logic.

## 1. OAuth & OIDC (OpenID Connect)

- **Standard Flow**: Always use the **Authorization Code flow with PKCE** (Proof Key for Code Exchange) for SPAs and mobile apps. Never use the Implicit Flow (it is deprecated and insecure).
- **State Parameter**: Always implement and validate the `state` parameter to prevent CSRF (Cross-Site Request Forgery) attacks during the OAuth callback.
- **Provider Scopes**: Request the minimum necessary scopes. Never request `offline_access` (refresh tokens) unless explicitly required and approved by the user.

## 2. JWT (JSON Web Tokens)

- **Signing Algorithms**: Always use asymmetric algorithms (e.g., `RS256`, `EdDSA`) if the token needs to be verified by multiple services. Use `HS256` only if the issuer and verifier are the exact same service. NEVER allow the `none` algorithm.
- **Payload Data**: Never put sensitive data (PII, passwords, internal IDs) inside a JWT payload. JWTs are Base64 encoded, not encrypted.
- **Expiration**: Keep short-lived access tokens (e.g., 15-60 minutes). Use Refresh Tokens for extending sessions.
- **Validation**: Always strictly validate the `exp` (expiration), `iss` (issuer), and `aud` (audience) claims on every request.

## 3. Session & Storage Management

- **Web Storage**: Never store JWTs or session IDs in `localStorage` or `sessionStorage` where they are vulnerable to XSS (Cross-Site Scripting) attacks.
- **Cookies**: Always store session tokens in cookies with strict attributes:
  - `HttpOnly`: True (prevents JavaScript access)
  - `Secure`: True (requires HTTPS)
  - `SameSite`: `Lax` or `Strict` (prevents CSRF)
- **Invalidation**: Ensure sessions can be revoked on the server side (e.g., via a Redis blocklist or database `sessions` table).

## 4. RBAC (Role-Based Access Control)

- **Defense in Depth**: UI-level checks (e.g., hiding a button) are not security. You MUST enforce authorization at the API/Controller layer.
- **Middleware**: Implement route-level middleware to protect endpoints.
- **Ownership Validation**: Beyond checking if a user is an "admin" or "user", always verify that the user _owns_ the specific resource they are trying to access (e.g., `WHERE user_id = ?`).

## 5. Common Providers (NextAuth, Clerk, Auth0)

- **NextAuth / Auth.js**: Keep the secret strictly in `.env.local`. Do not expose the secret to the client.
- **Clerk**: Use the Clerk middleware to protect routes. Ensure the publishable key is public, but the secret key remains on the server.
- **Auth0**: Validate the Auth0 domain and audience strictly in your SDK configuration.
