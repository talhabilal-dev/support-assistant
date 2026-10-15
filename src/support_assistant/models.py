"""Lightweight domain objects shared across the application."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID


class DocumentStatus:
    """Lifecycle states for an uploaded document."""

    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class EmailStatus:
    """Delivery states for a ticket email."""

    NOT_SENT = "not_sent"
    QUEUED = "queued"
    SENT = "sent"
    FAILED = "failed"


class TicketStatus:
    """Lifecycle states for a support ticket."""

    OPEN = "open"
    CLOSED = "closed"


@dataclass(slots=True)
class Document:
    id: UUID
    filename: str
    content_type: str | None
    size_bytes: int
    status: str
    error: str | None
    chunk_count: int
    created_at: datetime
    updated_at: datetime


@dataclass(slots=True)
class Conversation:
    id: UUID
    code: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(slots=True)
class ConversationMessage:
    id: UUID
    conversation_id: UUID
    role: str
    content: str
    sources: list | None
    created_at: datetime


@dataclass(slots=True)
class TicketReply:
    id: UUID
    ticket_id: UUID
    body: str
    created_at: datetime


@dataclass(slots=True)
class Ticket:
    id: UUID
    conversation_id: UUID | None
    email: str | None
    summary: str
    pain_point: str
    status: str
    email_status: str
    email_sent_at: datetime | None
    email_error: str | None
    created_at: datetime
    updated_at: datetime
    conversation_code: str | None = None
    replies: list = field(default_factory=list)


@dataclass(slots=True)
class RetrievedChunk:
    """A single chunk returned from hybrid retrieval."""

    chunk_id: UUID
    document_id: UUID
    filename: str
    content: str
    score: float
    vector_rank: int | None = None
    keyword_rank: int | None = None
