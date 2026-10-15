"""Data access for documents and chunks (raw SQL over asyncpg)."""

from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID, uuid4

import asyncpg

from .codes import generate_code
from .models import (
    Conversation,
    ConversationMessage,
    Document,
    RetrievedChunk,
    Ticket,
    TicketReply,
)

_DOCUMENT_COLUMNS = """
    id, filename, content_type, size_bytes, status, error,
    chunk_count, created_at, updated_at
"""


def to_vector_literal(values: Sequence[float]) -> str:
    """Serialise floats to the pgvector text format: ``[0.1,0.2,...]``."""
    return "[" + ",".join(f"{v:.8f}" for v in values) + "]"


class DocumentRepository:
    """CRUD for documents and their chunk embeddings."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def create_document(
        self,
        document_id: UUID,
        filename: str,
        content_type: str | None,
        content: bytes,
    ) -> Document:
        row = await self._pool.fetchrow(
            f"""
            INSERT INTO documents (id, filename, content_type, size_bytes, content)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING {_DOCUMENT_COLUMNS}
            """,
            document_id,
            filename,
            content_type,
            len(content),
            content,
        )
        return Document(**dict(row))

    async def list_documents(self, limit: int = 100) -> list[Document]:
        rows = await self._pool.fetch(
            f"SELECT {_DOCUMENT_COLUMNS} FROM documents ORDER BY created_at DESC LIMIT $1",
            limit,
        )
        return [Document(**dict(row)) for row in rows]

    async def get_document(self, document_id: UUID) -> Document | None:
        row = await self._pool.fetchrow(
            f"SELECT {_DOCUMENT_COLUMNS} FROM documents WHERE id = $1", document_id
        )
        return Document(**dict(row)) if row else None

    async def get_document_content(self, document_id: UUID) -> tuple[str, str | None, bytes] | None:
        """Return ``(filename, content_type, raw_bytes)`` for ingestion."""
        row = await self._pool.fetchrow(
            "SELECT filename, content_type, content FROM documents WHERE id = $1",
            document_id,
        )
        if row is None:
            return None
        return row["filename"], row["content_type"], bytes(row["content"])

    async def delete_document(self, document_id: UUID) -> bool:
        result = await self._pool.execute("DELETE FROM documents WHERE id = $1", document_id)
        return result.endswith(" 1")

    async def set_status(
        self,
        document_id: UUID,
        status: str,
        *,
        error: str | None = None,
        chunk_count: int | None = None,
    ) -> None:
        await self._pool.execute(
            """
            UPDATE documents
            SET status = $2,
                error = $3,
                chunk_count = COALESCE($4, chunk_count),
                updated_at = now()
            WHERE id = $1
            """,
            document_id,
            status,
            error,
            chunk_count,
        )

    async def replace_chunks(
        self,
        document_id: UUID,
        chunks: Sequence[tuple[UUID, int, str, Sequence[float] | None]],
    ) -> int:
        """Replace all chunks for a document. Returns the number written."""
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("DELETE FROM chunks WHERE document_id = $1", document_id)
                if not chunks:
                    return 0
                rows = [
                    (
                        chunk_id,
                        document_id,
                        index,
                        content,
                        len(content),
                        to_vector_literal(embedding) if embedding is not None else None,
                    )
                    for chunk_id, index, content, embedding in chunks
                ]
                await conn.executemany(
                    """
                    INSERT INTO chunks
                        (id, document_id, chunk_index, content, char_count, embedding)
                    VALUES ($1, $2, $3, $4, $5, CAST($6::text AS vector))
                    """,
                    rows,
                )
        return len(chunks)

    async def counts(self) -> tuple[int, int]:
        row = await self._pool.fetchrow(
            "SELECT (SELECT count(*) FROM documents) AS d, (SELECT count(*) FROM chunks) AS c"
        )
        return int(row["d"]), int(row["c"])

    async def sample_chunks(self, limit: int = 3) -> list[tuple[str, str]]:
        """Return up to ``limit`` random ``(content, filename)`` pairs from ready docs."""
        rows = await self._pool.fetch(
            """
            SELECT c.content, d.filename
            FROM chunks c
            JOIN documents d ON d.id = c.document_id
            WHERE d.status = 'ready'
            ORDER BY random()
            LIMIT $1
            """,
            limit,
        )
        return [(row["content"], row["filename"]) for row in rows]

    async def vector_search(
        self,
        embedding: Sequence[float],
        limit: int,
        document_ids: Sequence[UUID] | None = None,
    ) -> list[RetrievedChunk]:
        """Nearest chunks by cosine distance."""
        rows = await self._pool.fetch(
            """
            SELECT c.id AS chunk_id,
                   c.document_id,
                   d.filename,
                   c.content,
                   1 - (c.embedding <=> CAST($1::text AS vector)) AS score
            FROM chunks c
            JOIN documents d ON d.id = c.document_id
            WHERE c.embedding IS NOT NULL
              AND d.status = 'ready'
              AND ($3::uuid[] IS NULL OR c.document_id = ANY($3::uuid[]))
            ORDER BY c.embedding <=> CAST($1::text AS vector)
            LIMIT $2
            """,
            to_vector_literal(embedding),
            limit,
            list(document_ids) if document_ids else None,
        )
        return [
            RetrievedChunk(
                chunk_id=row["chunk_id"],
                document_id=row["document_id"],
                filename=row["filename"],
                content=row["content"],
                score=float(row["score"]),
            )
            for row in rows
        ]

    async def keyword_search(
        self,
        query: str,
        limit: int,
        document_ids: Sequence[UUID] | None = None,
    ) -> list[RetrievedChunk]:
        """Full-text keyword search ranked with ``ts_rank_cd``."""
        rows = await self._pool.fetch(
            """
            SELECT c.id AS chunk_id,
                   c.document_id,
                   d.filename,
                   c.content,
                   ts_rank_cd(c.content_tsv, plainto_tsquery('english', $1)) AS score
            FROM chunks c
            JOIN documents d ON d.id = c.document_id
            WHERE c.content_tsv @@ plainto_tsquery('english', $1)
              AND d.status = 'ready'
              AND ($3::uuid[] IS NULL OR c.document_id = ANY($3::uuid[]))
            ORDER BY score DESC
            LIMIT $2
            """,
            query,
            limit,
            list(document_ids) if document_ids else None,
        )
        return [
            RetrievedChunk(
                chunk_id=row["chunk_id"],
                document_id=row["document_id"],
                filename=row["filename"],
                content=row["content"],
                score=float(row["score"]),
            )
            for row in rows
        ]


class ConversationRepository:
    """Stores whole chat conversations and their messages."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def create_conversation(self) -> Conversation:
        """Create a conversation with a short, unique, resumable code."""
        for _ in range(5):
            try:
                row = await self._pool.fetchrow(
                    """
                    INSERT INTO conversations (id, code) VALUES ($1, $2)
                    RETURNING id, code, created_at, updated_at
                    """,
                    uuid4(),
                    generate_code(),
                )
                return Conversation(**dict(row))
            except asyncpg.UniqueViolationError:
                continue
        raise RuntimeError("could not allocate a unique conversation code")

    async def get_conversation(self, conversation_id: UUID) -> Conversation | None:
        row = await self._pool.fetchrow(
            "SELECT id, code, created_at, updated_at FROM conversations WHERE id = $1",
            conversation_id,
        )
        return Conversation(**dict(row)) if row else None

    async def get_conversation_by_code(self, code: str) -> Conversation | None:
        row = await self._pool.fetchrow(
            """
            SELECT id, code, created_at, updated_at
            FROM conversations WHERE lower(code) = lower($1)
            """,
            code.strip(),
        )
        return Conversation(**dict(row)) if row else None

    async def add_message(
        self,
        conversation_id: UUID,
        role: str,
        content: str,
        sources: list | None = None,
    ) -> ConversationMessage:
        row = await self._pool.fetchrow(
            """
            INSERT INTO chat_messages (id, conversation_id, role, content, sources)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, conversation_id, role, content, sources, created_at
            """,
            uuid4(),
            conversation_id,
            role,
            content,
            sources,
        )
        await self._pool.execute(
            "UPDATE conversations SET updated_at = now() WHERE id = $1", conversation_id
        )
        return ConversationMessage(**dict(row))

    async def get_messages(self, conversation_id: UUID) -> list[ConversationMessage]:
        rows = await self._pool.fetch(
            """
            SELECT id, conversation_id, role, content, sources, created_at
            FROM chat_messages
            WHERE conversation_id = $1
            ORDER BY created_at
            """,
            conversation_id,
        )
        return [ConversationMessage(**dict(row)) for row in rows]


class TicketRepository:
    """Stores support tickets distilled from conversations."""

    # Ticket row plus its conversation code and owner replies.
    _SELECT = """
        SELECT t.id, t.conversation_id, t.email, t.summary, t.pain_point, t.status,
               t.email_status, t.email_sent_at, t.email_error, t.created_at, t.updated_at,
               c.code AS conversation_code,
               COALESCE((
                   SELECT jsonb_agg(
                       jsonb_build_object(
                           'id', r.id, 'ticket_id', r.ticket_id,
                           'body', r.body, 'created_at', r.created_at
                       ) ORDER BY r.created_at
                   )
                   FROM ticket_replies r WHERE r.ticket_id = t.id
               ), '[]'::jsonb) AS replies
        FROM tickets t
        LEFT JOIN conversations c ON c.id = t.conversation_id
    """

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def create_ticket(
        self,
        conversation_id: UUID | None,
        email: str | None,
        summary: str,
        pain_point: str,
    ) -> Ticket:
        ticket_id = uuid4()
        await self._pool.execute(
            """
            INSERT INTO tickets (id, conversation_id, email, summary, pain_point)
            VALUES ($1, $2, $3, $4, $5)
            """,
            ticket_id,
            conversation_id,
            email,
            summary,
            pain_point,
        )
        ticket = await self.get_ticket(ticket_id)
        assert ticket is not None
        return ticket

    async def list_tickets(self, limit: int = 100) -> list[Ticket]:
        rows = await self._pool.fetch(
            f"{self._SELECT} ORDER BY t.created_at DESC LIMIT $1", limit
        )
        return [Ticket(**dict(row)) for row in rows]

    async def get_ticket(self, ticket_id: UUID) -> Ticket | None:
        row = await self._pool.fetchrow(f"{self._SELECT} WHERE t.id = $1", ticket_id)
        return Ticket(**dict(row)) if row else None

    async def find_for_conversation(self, conversation_id: UUID) -> list[Ticket]:
        """All tickets already logged for a conversation (oldest first)."""
        rows = await self._pool.fetch(
            f"{self._SELECT} WHERE t.conversation_id = $1 ORDER BY t.created_at",
            conversation_id,
        )
        return [Ticket(**dict(row)) for row in rows]

    async def find_similar(self, query: str, limit: int = 3) -> list[Ticket]:
        """Find existing tickets whose summary/pain point matches ``query``."""
        rows = await self._pool.fetch(
            """
            SELECT t.id, t.conversation_id, t.email, t.summary, t.pain_point, t.status,
                   t.email_status, t.email_sent_at, t.email_error, t.created_at, t.updated_at,
                   c.code AS conversation_code,
                   '[]'::jsonb AS replies,
                   ts_rank_cd(
                       to_tsvector('english', t.summary || ' ' || t.pain_point),
                       plainto_tsquery('english', $1)
                   ) AS rank
            FROM tickets t
            LEFT JOIN conversations c ON c.id = t.conversation_id
            WHERE to_tsvector('english', t.summary || ' ' || t.pain_point)
                  @@ plainto_tsquery('english', $1)
            ORDER BY rank DESC, t.created_at DESC
            LIMIT $2
            """,
            query,
            limit,
        )
        return [
            Ticket(**{key: value for key, value in dict(row).items() if key != "rank"})
            for row in rows
        ]

    async def add_reply(self, ticket_id: UUID, body: str) -> TicketReply:
        row = await self._pool.fetchrow(
            """
            INSERT INTO ticket_replies (id, ticket_id, body)
            VALUES ($1, $2, $3)
            RETURNING id, ticket_id, body, created_at
            """,
            uuid4(),
            ticket_id,
            body,
        )
        return TicketReply(**dict(row))

    async def list_replies(self, ticket_id: UUID) -> list[TicketReply]:
        rows = await self._pool.fetch(
            """
            SELECT id, ticket_id, body, created_at
            FROM ticket_replies WHERE ticket_id = $1 ORDER BY created_at
            """,
            ticket_id,
        )
        return [TicketReply(**dict(row)) for row in rows]

    async def set_email(self, ticket_id: UUID, email: str, status: str) -> None:
        await self._pool.execute(
            """
            UPDATE tickets
            SET email = $2, email_status = $3, updated_at = now()
            WHERE id = $1
            """,
            ticket_id,
            email,
            status,
        )

    async def set_email_status(
        self,
        ticket_id: UUID,
        status: str,
        error: str | None = None,
    ) -> None:
        await self._pool.execute(
            """
            UPDATE tickets
            SET email_status = $2,
                email_error = $3,
                email_sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE email_sent_at END,
                updated_at = now()
            WHERE id = $1
            """,
            ticket_id,
            status,
            error,
        )
