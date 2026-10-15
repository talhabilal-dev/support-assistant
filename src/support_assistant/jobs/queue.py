"""PgQueuer queue helpers.

The queue tables live in the same PostgreSQL database as the application data.
"""

from __future__ import annotations

import json
from uuid import UUID

import asyncpg
from pgqueuer.queries import Queries

INGEST_DOCUMENT = "ingest_document"
SEND_TICKET_EMAIL = "send_ticket_email"


class JobQueue:
    """Thin wrapper around PgQueuer's query interface for enqueuing work."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def enqueue_ingestion(self, document_id: UUID) -> None:
        """Queue a document-embedding job for the worker."""
        queries = Queries.from_asyncpg_pool(self._pool)
        await queries.enqueue(INGEST_DOCUMENT, str(document_id).encode())

    async def enqueue_ticket_email(self, ticket_id: UUID) -> None:
        """Queue the standard confirmation email for a ticket."""
        await self._enqueue_email({"ticket_id": str(ticket_id), "kind": "confirmation"})

    async def enqueue_ticket_reply(self, ticket_id: UUID, message: str) -> None:
        """Queue an owner reply email for a ticket."""
        await self._enqueue_email(
            {"ticket_id": str(ticket_id), "kind": "reply", "message": message}
        )

    async def _enqueue_email(self, payload: dict) -> None:
        queries = Queries.from_asyncpg_pool(self._pool)
        await queries.enqueue(SEND_TICKET_EMAIL, json.dumps(payload).encode())


async def install_queue_schema(pool: asyncpg.Pool) -> None:
    """Ensure the PgQueuer schema exists.

    ``install`` is not idempotent (``CREATE TYPE`` has no ``IF NOT EXISTS``), so
    on an existing installation we run the idempotent ``upgrade`` instead.
    """
    queries = Queries.from_asyncpg_pool(pool)
    if await queries.schema_is_installed():
        await queries.upgrade()
    else:
        await queries.install()
