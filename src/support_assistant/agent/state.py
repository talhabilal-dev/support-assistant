"""Shared state for the RAG graph."""

from __future__ import annotations

from typing import Annotated, TypedDict
from uuid import UUID

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages

from ..models import RetrievedChunk


class RAGState(TypedDict, total=False):
    """State threaded through the retrieve -> (correct) -> agent/tools graph."""

    messages: Annotated[list[BaseMessage], add_messages]
    question: str
    conversation_id: UUID | None
    document_ids: list[UUID] | None
    documents: list[RetrievedChunk]
    context: str
    answer: str
    crag_iterations: int
