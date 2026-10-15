"""PostgreSQL access: a single asyncpg pool shared by the app and PgQueuer.

Everything lives in the same database: documents, chunks (with pgvector
embeddings) and the PgQueuer job tables. We use raw SQL over asyncpg rather
than an ORM so that:

* the pgvector ``vector`` type can be written/queried without the ``pgvector``
  Python package (values are passed as text and cast with ``::vector``), and
* the PgQueuer worker and the FastAPI app share one connection pool.
"""

from __future__ import annotations

import json

import asyncpg

from .codes import generate_code
from .config import Settings
from .log import get_logger

logger = get_logger(__name__)

# ``{dim}`` is filled from settings.embedding_dimensions.
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS documents (
    id            UUID PRIMARY KEY,
    filename      TEXT NOT NULL,
    content_type  TEXT,
    size_bytes    BIGINT NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'pending',
    error         TEXT,
    chunk_count   INTEGER NOT NULL DEFAULT 0,
    content       BYTEA NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
    id            UUID PRIMARY KEY,
    document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index   INTEGER NOT NULL,
    content       TEXT NOT NULL,
    char_count    INTEGER NOT NULL DEFAULT 0,
    embedding     vector({dim}),
    content_tsv   tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chunks_document_id_idx ON chunks (document_id);
CREATE INDEX IF NOT EXISTS chunks_content_tsv_idx ON chunks USING gin (content_tsv);
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
    ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS conversations (
    id          UUID PRIMARY KEY,
    code        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- For installs created before resumable conversations existed.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_code_idx ON conversations (code);

CREATE TABLE IF NOT EXISTS chat_messages (
    id              UUID PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    sources         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_conversation_idx
    ON chat_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS tickets (
    id              UUID PRIMARY KEY,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    email           TEXT,
    summary         TEXT NOT NULL,
    pain_point      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open',
    email_status    TEXT NOT NULL DEFAULT 'not_sent',
    email_sent_at   TIMESTAMPTZ,
    email_error     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tickets_created_idx ON tickets (created_at DESC);
CREATE INDEX IF NOT EXISTS tickets_conversation_idx ON tickets (conversation_id);

CREATE TABLE IF NOT EXISTS ticket_replies (
    id          UUID PRIMARY KEY,
    ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_replies_ticket_idx
    ON ticket_replies (ticket_id, created_at);
"""


async def _init_connection(conn: asyncpg.Connection) -> None:
    """Decode/encode JSONB transparently as Python objects."""
    await conn.set_type_codec(
        "jsonb",
        encoder=json.dumps,
        decoder=json.loads,
        schema="pg_catalog",
    )


async def create_pool(settings: Settings) -> asyncpg.Pool:
    """Create the shared asyncpg connection pool."""
    logger.info("connecting to database")
    return await asyncpg.create_pool(
        dsn=settings.database_url,
        min_size=settings.db_pool_min_size,
        max_size=settings.db_pool_max_size,
        init=_init_connection,
    )


async def init_schema(pool: asyncpg.Pool, settings: Settings) -> None:
    """Create the pgvector extension and the application tables/indexes."""
    async with pool.acquire() as conn:
        await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        await conn.execute(SCHEMA_SQL.format(dim=settings.embedding_dimensions))
        await _backfill_conversation_codes(conn)
    logger.info("database schema ready")


async def _backfill_conversation_codes(conn: asyncpg.Connection) -> None:
    """Give conversations created before resumable codes existed a code."""
    rows = await conn.fetch("SELECT id FROM conversations WHERE code IS NULL")
    for row in rows:
        for _ in range(5):
            try:
                await conn.execute(
                    "UPDATE conversations SET code = $2 WHERE id = $1",
                    row["id"],
                    generate_code(),
                )
                break
            except asyncpg.UniqueViolationError:
                continue
