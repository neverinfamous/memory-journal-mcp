# Community Standards Templates

Full templates for community health files. Read on demand when setting up a new repo.

---

## CONTRIBUTING.md

```markdown
# Contributing to {{REPO_NAME}}

Thank you for your interest in contributing! This guide will help you get started.

## Getting Started

1. **Fork** the repository
2. **Clone** your fork: `git clone git@github.com:YOUR_USERNAME/{{REPO_NAME}}.git`
3. **Create a branch**: `git checkout -b feature/your-feature`
4. **Install dependencies**: `npm install`
5. **Make your changes**
6. **Run checks**: `npm run check && npm run test`
7. **Commit**: `git commit -m "feat: description of your change"`
8. **Push**: `git push origin feature/your-feature`
9. **Open a Pull Request**

## Development Setup

### Prerequisites

- Node.js >= 24.0.0
- npm

### Commands

| Command             | Description               |
| ------------------- | ------------------------- |
| `npm run build`     | Build the project         |
| `npm run dev`       | Start development mode    |
| `npm run lint`      | Run ESLint                |
| `npm run lint:fix`  | Auto-fix lint issues      |
| `npm run typecheck` | TypeScript type checking  |
| `npm run test`      | Run unit tests            |
| `npm run test:e2e`  | Run E2E tests             |
| `npm run check`     | Lint + typecheck combined |

## Code Style

- TypeScript strict mode with ESLint 10
- Prettier for formatting (runs automatically in CI)
- Follow existing patterns in the codebase

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation only
- `refactor:` — Code change that neither fixes a bug nor adds a feature
- `test:` — Adding or updating tests
- `chore:` — Maintenance tasks

## Pull Request Process

1. Update documentation if needed
2. Add tests for new functionality
3. Ensure all checks pass
4. One approval required for merge

## Reporting Issues

Use the [Issue Templates](https://github.com/neverinfamous/{{REPO_NAME}}/issues/new/choose) to report bugs or request features.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
```

---

## CODE_OF_CONDUCT.md

Use the [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) with contact: `admin@adamic.tech`.

Download the full text from the link above and replace the contact placeholder. The file should be ~130 lines.

---

## SECURITY.md

```markdown
# Security Policy

## Supported Versions

| Version  | Supported |
| -------- | --------- |
| Latest   | ✅        |
| < Latest | ❌        |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to **admin@adamic.tech**.

### What to Include

- Description of the vulnerability
- Steps to reproduce the issue
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **48 hours** — Initial acknowledgment
- **7 days** — Assessment and action plan
- **30 days** — Fix released (for confirmed vulnerabilities)

### Safe Harbor

We consider security research conducted in good faith to be authorized. We will not pursue legal action against researchers who:

- Make a good faith effort to avoid privacy violations and data destruction
- Provide us reasonable time to address the issue before disclosure
- Do not exploit the vulnerability beyond what is necessary to demonstrate it

## Security Best Practices

When contributing, please follow these security practices:

- Never commit secrets, API keys, or credentials
- Use parameterized queries for any database operations
- Validate and sanitize all user inputs
- Follow the principle of least privilege
```
