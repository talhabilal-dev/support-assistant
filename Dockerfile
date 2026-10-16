# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# 1. Frontend build
#
# `frontend/` is gitignored, so this stage builds it when present and falls
# back to the committed `static/` otherwise. A git-based builder that has no
# `frontend/` therefore still works, as long as `static/` is committed.
# ---------------------------------------------------------------------------
FROM node:24-slim AS web

ARG PNPM_VERSION=10
WORKDIR /src
COPY . .

RUN set -eux; \
    if [ -f frontend/package.json ]; then \
      npm install -g "pnpm@${PNPM_VERSION}"; \
      cd frontend; \
      pnpm install --frozen-lockfile; \
      pnpm build; \
      cd ..; \
    fi; \
    if [ ! -f static/index.html ]; then \
      echo "ERROR: no static/index.html. Either include frontend/ in the build" >&2; \
      echo "       context, or commit a built static/ directory." >&2; \
      exit 1; \
    fi

# ---------------------------------------------------------------------------
# 2. Python dependencies
#
# Built in its own stage so build tooling (gcc, in case asyncpg or another C
# extension has no wheel yet) never reaches the runtime image.
# ---------------------------------------------------------------------------
FROM python:3.14-slim AS deps

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV UV_PYTHON_DOWNLOADS=0 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app
# README.md is required: pyproject.toml declares `readme = "README.md"`.
COPY pyproject.toml uv.lock .python-version README.md ./
RUN uv sync --frozen --no-install-project --no-dev

# The project is installed editable, so the source must stay at /app/src:
# config.py derives the project root (and thus `static/`) from its own path.
COPY src ./src
RUN uv sync --frozen --no-dev

# ---------------------------------------------------------------------------
# 3. Runtime
# ---------------------------------------------------------------------------
FROM python:3.14-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH" \
    HOST=0.0.0.0 \
    PORT=8000 \
    FRONTEND_DIST=static

WORKDIR /app

COPY --from=deps /app/.venv /app/.venv
COPY pyproject.toml uv.lock ./
COPY src ./src
COPY --from=web /src/static ./static

# Runs as a non-root user; the app writes nothing to disk (uploads live in
# Postgres), so no volumes are needed.
RUN useradd --create-home --uid 10001 appuser \
 && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"

# Default process is the API server; the worker overrides this
# (dockerCommand / [processes] / a second service).
CMD ["support-assistant", "api"]
