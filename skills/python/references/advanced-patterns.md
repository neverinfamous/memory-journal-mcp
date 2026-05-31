# Advanced Python Patterns

## Async & Concurrency

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

## Data Validation: Pydantic v2

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

## Security & Safety

- **SQL Injection**: Never use string interpolation for SQL queries. Use an ORM (SQLAlchemy, Django ORM) or parameterized queries (e.g., `cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))`).
- **Secrets Management**: Never commit `.env` files or hardcode credentials. Use `python-decouple` or `os.environ` to read secrets from the environment.
- **CSRF & Auth**: Always enable CSRF protection in web frameworks (e.g., `CsrfViewMiddleware` in Django).
- **Input Validation**: Validate all untrusted input at the boundaries using Pydantic models.
