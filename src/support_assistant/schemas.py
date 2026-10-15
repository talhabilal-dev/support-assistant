"""Pydantic models for the HTTP API."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DocumentOut(BaseModel):
    """Public representation of an uploaded document."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    filename: str
    content_type: str | None = None
    size_bytes: int
    status: str
    error: str | None = None
    chunk_count: int
    created_at: datetime
    updated_at: datetime


class DocumentListOut(BaseModel):
    documents: list[DocumentOut]


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    conversation_id: UUID | None = None
    document_ids: list[UUID] | None = Field(
        default=None,
        description="Restrict retrieval to these documents. Omit to search all.",
    )


class SourceChunk(BaseModel):
    document_id: UUID
    chunk_id: UUID
    filename: str
    score: float
    content: str


class ChatResponse(BaseModel):
    answer: str
    sources: list[SourceChunk]
    conversation_id: UUID
    conversation_code: str | None = None


class ConversationMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    role: str
    content: str
    sources: list[SourceChunk] | None = None
    created_at: datetime


class ConversationOut(BaseModel):
    conversation_id: UUID
    code: str | None = None
    messages: list[ConversationMessageOut]


class TicketReplyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    ticket_id: UUID
    body: str
    created_at: datetime


class TicketOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    conversation_id: UUID | None = None
    conversation_code: str | None = None
    email: str | None = None
    summary: str
    pain_point: str
    status: str
    email_status: str
    email_sent_at: datetime | None = None
    email_error: str | None = None
    replies: list[TicketReplyOut] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class TicketListOut(BaseModel):
    tickets: list[TicketOut]


class TicketEmailRequest(BaseModel):
    email: str | None = Field(
        default=None,
        description="Override or provide the recipient email address.",
    )


class TicketReplyRequest(BaseModel):
    message: str = Field(min_length=1)


class SuggestionsOut(BaseModel):
    suggestions: list[str]


class HealthOut(BaseModel):
    status: str
    database: str
    documents: int
    chunks: int
