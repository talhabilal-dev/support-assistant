"""FastAPI dependency helpers built on ``request.app.state``."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from ..agent.service import ChatService
from ..agent.suggestions import SuggestionService
from ..config import Settings
from ..jobs.queue import JobQueue
from ..repositories import (
    ConversationRepository,
    DocumentRepository,
    TicketRepository,
)


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_repository(request: Request) -> DocumentRepository:
    return DocumentRepository(request.app.state.pool)


def get_ticket_repository(request: Request) -> TicketRepository:
    return TicketRepository(request.app.state.pool)


def get_conversation_repository(request: Request) -> ConversationRepository:
    return ConversationRepository(request.app.state.pool)


def get_queue(request: Request) -> JobQueue:
    return request.app.state.queue


def get_chat_service(request: Request) -> ChatService:
    return request.app.state.chat_service


def get_suggestion_service(request: Request) -> SuggestionService:
    return request.app.state.suggestions


SettingsDep = Annotated[Settings, Depends(get_settings)]
RepositoryDep = Annotated[DocumentRepository, Depends(get_repository)]
TicketRepositoryDep = Annotated[TicketRepository, Depends(get_ticket_repository)]
ConversationRepositoryDep = Annotated[
    ConversationRepository, Depends(get_conversation_repository)
]
QueueDep = Annotated[JobQueue, Depends(get_queue)]
ChatServiceDep = Annotated[ChatService, Depends(get_chat_service)]
SuggestionServiceDep = Annotated[SuggestionService, Depends(get_suggestion_service)]
