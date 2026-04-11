---
name: python
description: |
  Master modern Python development with production-grade tooling and idioms.
  Use when writing Python code, configuring project structure, managing
  dependencies with uv, linting with ruff, adding type hints, writing pytest
  tests, or building FastAPI/Django/Flask applications. Triggers on "Python",
  "FastAPI", "Django", "Flask", "pytest", "uv", "ruff", "pyproject.toml".
---

# Python Engineering Standards

This skill codifies 2026 Python best practices — modern tooling (`uv`, `ruff`), strict typing, and idiomatic patterns that produce maintainable, performant code.

## 1. Project Setup & Structure

### Tooling: `uv` (Not pip/pipenv/poetry)

`uv` is the standard package manager for Python in 2026. It replaces pip, pipenv, and poetry with a single, fast Rust binary.

```bash
uv init <project-name>       # Initialize a new project
uv add <package>              # Add a dependency
uv add --dev <package>        # Add a dev dependency
uv run <command>              # Run a command in the project's venv
uv sync                      # Install all deps from uv.lock
uv python install 3.13        # Install a specific Python version
```

- **ALWAYS** commit both `pyproject.toml` AND `uv.lock` to version control.
- **NEVER** use `requirements.txt` for new projects — it is a legacy pattern.
- **NEVER** use `pip install` directly — use `uv add` to keep the lock file in sync.

### Directory Layout: `src/` Layout

```
my-project/
├── .python-version          # Pin Python version (e.g., 3.13)
├── pyproject.toml           # Single source of truth for config
├── uv.lock                  # Deterministic lock file
├── src/
│   └── my_package/
│       ├── __init__.py
│       ├── main.py
│       └── models.py
└── tests/
    ├── __init__.py
    ├── conftest.py          # Shared fixtures
    └── test_main.py
```

- **Use `src/` layout** for packages and production apps — it prevents tests from accidentally importing the local source instead of the installed package.
- **Group by domain**, not file type — prefer `users/`, `billing/`, `auth/` over `models/`, `utils/`, `services/`.
- **Use `kebab-case`** for directory names, `snake_case` for Python modules.

### `pyproject.toml` Configuration (PEP 621)

```toml
[project]
name = "my-package"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "httpx>=0.27",
    "pydantic>=2.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "ruff>=0.8", "mypy>=1.13"]

[tool.ruff]
target-version = "py312"
line-length = 88

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "SIM", "RUF"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["src"]
```

## 2. Type Hints (Mandatory)

Type hints are **not optional** — they are foundational design tools.

### Rules

- **Use built-in generics** (Python 3.9+): `list[str]`, `dict[str, int]`, `tuple[int, ...]`
- **Use union syntax** (Python 3.10+): `str | None` instead of `Optional[str]`
- **Avoid `Any`** — use `object`, `Unknown`, or narrow with type guards
- **Use `TypedDict`** for dict-shaped data with known keys
- **Use `Protocol`** for structural subtyping instead of ABCs
- **Run static analysis**: `mypy --strict` or `pyright`

### Examples

```python
# ✅ Good
def get_user(user_id: int) -> User | None:
    ...

class Config(TypedDict):
    host: str
    port: int
    debug: bool

# ❌ Bad
def get_user(user_id):  # Missing type hints
    ...

def process(data: Any):  # Untyped escape hatch
    ...
```

## 3. Code Quality: `ruff`

Ruff is the **all-in-one** linter and formatter for Python. It replaces Flake8, Black, isort, pyupgrade, and more.

```bash
ruff check --fix .    # Lint with auto-fix
ruff format .         # Format (replaces Black)
```

### Configuration in `pyproject.toml`

```toml
[tool.ruff]
target-version = "py312"
line-length = 88
src = ["src", "tests"]

[tool.ruff.lint]
select = [
    "E",    # pycodestyle errors
    "F",    # pyflakes
    "I",    # isort
    "UP",   # pyupgrade
    "B",    # bugbear
    "SIM",  # simplify
    "RUF",  # ruff-specific
]
```

- **NEVER** use `# noqa` to suppress linter errors unless the suppression is explicitly justified by a comment explaining *why*.
- **NEVER** use `# type: ignore` — fix the type error or use a proper type guard.

## 4. Error Handling

### Patterns

- **Use specific exception types** — never catch bare `except:` or `except Exception:`
- **Create custom exceptions** inheriting from a base project exception
- **Use `from` for exception chaining**: `raise ValueError("msg") from original_error`
- **Never swallow exceptions silently** — at minimum, log them

```python
# ✅ Good
class AppError(Exception):
    """Base exception for the application."""

class NotFoundError(AppError):
    """Raised when a resource is not found."""

try:
    user = get_user(user_id)
except DatabaseError as e:
    raise NotFoundError(f"User {user_id} not found") from e

# ❌ Bad
try:
    user = get_user(user_id)
except:           # Bare except — catches SystemExit, KeyboardInterrupt
    pass          # Silently swallowed
```

## 5. Testing with `pytest`

### Structure

- **AAA pattern**: Arrange, Act, Assert — one concern per test
- **Use fixtures** for setup/teardown, not classes with `setUp()`/`tearDown()`
- **Use `conftest.py`** for shared fixtures across test modules
- **Use `@pytest.mark.parametrize`** for data-driven tests

```python
@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    """Create a test client with a temporary database."""
    app = create_app(db_path=tmp_path / "test.db")
    return TestClient(app)

@pytest.mark.parametrize("status_code,expected", [
    (200, True),
    (404, False),
    (500, False),
])
def test_is_success(status_code: int, expected: bool) -> None:
    assert is_success(status_code) == expected
```

### Running Tests

```bash
uv run pytest                           # Run all tests
uv run pytest tests/test_main.py        # Run specific file
uv run pytest -k "test_user"            # Run by pattern
uv run pytest --cov=src --cov-report=term-missing  # Coverage
```

## 6. Async & Concurrency

- **Use `asyncio`** for I/O-bound concurrency (HTTP calls, DB queries)
- **Use `async def` / `await`** — never mix sync and async code paths
- **Use `asyncio.TaskGroup`** (Python 3.11+) for structured concurrency
- **Use `httpx`** (async-native) instead of `requests` for HTTP clients

```python
async with asyncio.TaskGroup() as tg:
    task1 = tg.create_task(fetch_user(user_id))
    task2 = tg.create_task(fetch_orders(user_id))
# Both tasks complete here — exceptions propagate cleanly
```

## 7. Data Validation: Pydantic v2

- **Use Pydantic models** at system boundaries (API requests, config files, DB results)
- **Never trust external input** — validate with `model_validate()`, not dict access
- **Use `Field()` validators** for constraints, not manual `if` checks

```python
from pydantic import BaseModel, Field

class CreateUserRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: str = Field(pattern=r"^[\w.-]+@[\w.-]+\.\w+$")
    age: int = Field(ge=0, le=150)
```

## 8. Anti-Patterns (Never Do These)

| Anti-Pattern | Why It's Wrong | Do This Instead |
|-------------|---------------|-----------------|
| `import *` | Pollutes namespace, breaks tooling | Explicit imports |
| Mutable default args (`def f(x=[])`) | Shared across calls | Use `None` + assign |
| Global mutable state | Thread-unsafe, untestable | Dependency injection |
| `os.path` for path manipulation | Platform-inconsistent | Use `pathlib.Path` |
| `print()` for logging | No levels, no rotation | Use `logging` or `structlog` |
| `== None` / `== True` | Wrong semantics | `is None` / `is True` |

## 9. Web Frameworks Quick Reference

| Framework | Best For | Key Pattern |
|-----------|---------|-------------|
| **FastAPI** | REST APIs, async, auto-docs | Pydantic models, dependency injection, `async def` routes |
| **Django** | Full-stack, admin, ORM | Models → Views → Templates, `manage.py`, migrations |
| **Flask** | Lightweight APIs, prototypes | Blueprints, application factory pattern |
